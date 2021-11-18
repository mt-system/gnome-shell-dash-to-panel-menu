/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/* exported init enable disable */

const {
    Atk,
    Clutter,
    Gio,
    GLib,
    GMenu,
    GObject,
    Gtk,
    Meta,
    Shell,
    St,
} = imports.gi;
const Signals = imports.signals;

const DND = imports.ui.dnd;
const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const AppDisplay = imports.ui.appDisplay;
// const ParentalControlsManager = imports.misc.parentalControlsManager;


const Me = imports.misc.extensionUtils.getCurrentExtension();

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

const appSys = Shell.AppSystem.get_default();

const APPLICATION_ICON_SIZE = 32;
const HORIZ_FACTOR = 5;
const MENU_HEIGHT_OFFSET = 132;
const NAVIGATION_REGION_OVERSHOOT = 50;

Gio._promisify(Gio._LocalFilePrototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio._LocalFilePrototype, 'set_attributes_async', 'set_attributes_finish');


const ApplicationMenuItem = GObject.registerClass(
    class ApplicationMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(button, app) {
            super._init();

            this._app = app;
            this._button = button;

            this._iconBin = new St.Bin();
            this.add_child(this._iconBin);

            const appLabel = new St.Label({
                text: app.get_name(),
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this.add_child(appLabel);
            this.label_actor = appLabel;

            const textureCache = St.TextureCache.get_default();
            const iconThemeChangedId = textureCache.connect('icon-theme-changed', this._updateIcon.bind(this));

            this.connect('destroy', () => textureCache.disconnect(iconThemeChangedId));
            this._updateIcon();

            this._delegate = this;
            const draggable = DND.makeDraggable(this);

            const maybeStartDrag = draggable._maybeStartDrag;

            draggable._maybeStartDrag = event => {
                if (this._dragEnabled)
                    return maybeStartDrag.call(draggable, event);

                return false;
            };
        }

        activate(event) {
            this._app.open_new_window(-1);
            this._button.selectCategory(null);
            this._button.menu.toggle();

            super.activate(event);

            Main.overview.hide();
        }

        setActive(active, params) {
            if (active)
                this._button.scrollToButton(this);

            super.setActive(active, params);
        }

        setDragEnabled(enabled) {
            this._dragEnabled = enabled;
        }

        getDragActor() {
            return this._app.create_icon_texture(APPLICATION_ICON_SIZE);
        }

        getDragActorSource() {
            return this._iconBin;
        }

        _updateIcon() {
            const icon = this.getDragActor();
            // icon.style_class = 'icon-dropshadow';
            this._iconBin.set_child(icon);
        }
    });



const CategoryMenuItem = GObject.registerClass(
    class CategoryMenuItem extends PopupMenu.PopupBaseMenuItem {
        _init(button, category) {
            super._init();
            this._category = category;
            this._button = button;

            this._oldX = -1;
            this._oldY = -1;

            let name;
            if (this._category)
                name = this._category.get_name();
            else
                name = _('Favorites');

            this.add_child(new St.Label({ text: name }));
            this.connect('motion-event', this._onMotionEvent.bind(this));
            this.connect('notify::active', this._onActiveChanged.bind(this));
        }

        activate(event) {
            this._button.selectCategory(this._category);
            this._button.scrollToCatButton(this);
            super.activate(event);
        }

        _isNavigatingSubmenu([ x, y ]) {
            const [ posX, posY ] = this.get_transformed_position();

            if (this._oldX === -1) {
                this._oldX = x;
                this._oldY = y;
                return true;
            }

            const deltaX = Math.abs(x - this._oldX);
            const deltaY = Math.abs(y - this._oldY);

            this._oldX = x;
            this._oldY = y;

            // If it lies outside the x-coordinates then it is definitely outside.
            if (posX > x || posX + this.width < x)
                return false;

            // If it lies inside the menu item then it is definitely inside.
            if (posY <= y && posY + this.height >= y)
                return true;

            // We want the keep-up triangle only if the movement is more
            // horizontal than vertical.
            if (deltaX * HORIZ_FACTOR < deltaY)
                return false;

            // Check whether the point lies inside triangle ABC, and a similar
            // triangle on the other side of the menu item.
            //
            //   +---------------------+
            //   | menu item           |
            // A +---------------------+ C
            //              P          |
            //                         B

            // Ensure that the point P always lies below line AC so that we can
            // only check for triangle ABC.
            if (posY > y) {
                const offset = posY - y;
                y = posY + this.height + offset;
            }

            // Ensure that A is (0, 0).
            x -= posX;
            y -= posY + this.height;

            // Check which side of line AB the point P lies on by taking the
            // cross-product of AB and AP. See:
            // http://stackoverflow.com/questions/3461453/determine-which-side-of-a-line-a-point-lies
            if (this.width * y - NAVIGATION_REGION_OVERSHOOT * x <= 0)
                return true;

            return false;
        }

        _onMotionEvent(actor, event) {
            const device = event.get_device();
            if (!device.get_grabbed_actor()) {
                this._oldX = -1;
                this._oldY = -1;
                device.grab(this);
            }
            this.hover = true;

            if (this._isNavigatingSubmenu(event.get_coords()))
                return true;

            this._oldX = -1;
            this._oldY = -1;
            this.hover = false;
            device.ungrab();

            const source = event.get_source();
            if (source instanceof St.Widget)
                source.sync_hover();

            return false;
        }

        _onActiveChanged() {
            if (!this.active)
                return;

            this._button.selectCategory(this._category);
            this._button.scrollToCatButton(this);
        }
    });


class DesktopTarget {

    constructor() {
        this._desktop = null;
        this._desktopDestroyedId = 0;

        this._windowAddedId =
            global.window_group.connect('actor-added',
                this._onWindowAdded.bind(this));

        global.get_window_actors().forEach(a => {
            this._onWindowAdded(a.get_parent(), a);
        });
    }

    get hasDesktop() {
        return this._desktop !== null;
    }

    _onWindowAdded(group, actor) {
        if (!(actor instanceof Meta.WindowActor))
            return;

        if (actor.meta_window.get_window_type() === Meta.WindowType.DESKTOP)
            this._setDesktop(actor);
    }

    _setDesktop(desktop) {
        if (this._desktop) {
            this._desktop.disconnect(this._desktopDestroyedId);
            this._desktopDestroyedId = 0;

            delete this._desktop._delegate;
        }

        this._desktop = desktop;
        this.emit('desktop-changed');

        if (this._desktop) {
            this._desktopDestroyedId = this._desktop.connect('destroy', () => {
                this._setDesktop(null);
            });

            this._desktop._delegate = this;
        }
    }

    _getSourceAppInfo(source) {
        if (!(source instanceof ApplicationMenuItem))
            return null;

        return source._app.app_info;
    }

    async _markTrusted(file) {
        const modeAttr = Gio.FILE_ATTRIBUTE_UNIX_MODE;
        const trustedAttr = 'metadata::trusted';
        const queryFlags = Gio.FileQueryInfoFlags.NONE;
        const ioPriority = GLib.PRIORITY_DEFAULT;

        try {
            let info = await file.query_info_async(modeAttr, queryFlags, ioPriority, null);

            const mode = info.get_attribute_uint32(modeAttr) | 0o100;

            info.set_attribute_uint32(modeAttr, mode);
            info.set_attribute_string(trustedAttr, 'yes');

            await file.set_attributes_async(info, queryFlags, ioPriority, null);

            // Hack: force nautilus to reload file info
            info = new Gio.FileInfo();
            info.set_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_ACCESS, GLib.get_real_time());

            try {
                await file.set_attributes_async(info, queryFlags, ioPriority, null);
            } catch (e) {
                log(`Failed to update access time: ${e.message}`);
            }

        } catch (e) {
            log(`Failed to mark file as trusted: ${e.message}`);
        }
    }

    destroy() {
        if (this._windowAddedId)
            global.window_group.disconnect(this._windowAddedId);
        this._windowAddedId = 0;

        this._setDesktop(null);
    }

    handleDragOver(source, _actor, _x, _y, _time) {
        const appInfo = this._getSourceAppInfo(source);

        if (!appInfo)
            return DND.DragMotionResult.CONTINUE;

        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, _x, _y, _time) {
        const appInfo = this._getSourceAppInfo(source);

        if (!appInfo)
            return false;

        this.emit('app-dropped');

        const desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);

        const src = Gio.File.new_for_path(appInfo.get_filename());
        const dst = Gio.File.new_for_path(GLib.build_filenamev([ desktop, src.get_basename() ]));

        try {
            // copy_async() isn't introspectable :-(
            src.copy(dst, Gio.FileCopyFlags.OVERWRITE, null, null);
            this._markTrusted(dst);
        } catch (e) {
            log(`Failed to copy to desktop: ${e.message}`);
        }

        return true;
    }
}

Signals.addSignalMethods(DesktopTarget.prototype);


// I retrieved the Gnome Shell extensions => apps-menu@gnome-shell-extensions.gcampax.github.com
// to inject it in the Dash to Panel extensions :)))

class Menu extends PopupMenu.PopupMenu {
    constructor(source, dtpPanel) {

        /* let side = St.Side.LEFT;

        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL)
            side = St.Side.RIGHT; */

        // sourceActor, arrowAlignment, arrowSide
        super(source, 1.0, dtpPanel.getPosition()); // side
        // We want to keep the item hovered while the menu is up
        this.blockSourceEvents = true;

        this._source = source;


        // this._parentalControlsManager = ParentalControlsManager.getDefault();

        // this.actor.add_style_class_name('app-well-menu');

        // Chain our visibility and lifecycle to that of the source
        /* this._sourceMappedId = source.connect('notify::mapped', () => {
            if (!source.mapped)
                this.close();
        });

        source.connect('destroy', () => {
            source.disconnect(this._sourceMappedId);
            this.destroy();
        });

        Main.uiGroup.add_actor(this.actor);
        */

        this.actor.add_style_class_name('panel-menu');
        this.connect('open-state-changed', this._onOpenStateChanged.bind(this));

        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();

        /// //////////////////////////////////////////////////////////////////

        /* this._showingId = Main.overview.connect('showing', () => {
            this.add_accessible_state(Atk.StateType.CHECKED);
        });

        this._hidingId = Main.overview.connect('hiding', () => {
            this.remove_accessible_state(Atk.StateType.CHECKED);
        });

        Main.layoutManager.connect('startup-complete', this._setKeybinding.bind(this));
        this._setKeybinding(); */

        this._desktopTarget = new DesktopTarget();
        this._desktopTarget.connect('app-dropped', () => { this.close(); });

        this._desktopTarget.connect('desktop-changed', () => {
            this._applicationsButtons.forEach(item => {
                item.setDragEnabled(this._desktopTarget.hasDesktop);
            });
        });

        this.reloadFlag = false;
        this._applicationsButtons = new Map();

        // this._installedChangedId = appSys.connect('installed-changed', this._onTreeChanged.bind(this));


    }

    isEmpty() {
        return false;
    }

    toggle() {
        if (this.isOpen)
            this.selectCategory(null);

        super.toggle();
    }

    _onTreeChanged() {
        if (this.isOpen) {
            this._redisplay();
            this.mainBox.show();
        } else {
            this.reloadFlag = true;
        }
    }

    _createVertSeparator() {
        const separator = new St.DrawingArea({
            style_class: 'calendar-vertical-separator',
            pseudo_class: 'highlighted',
        });

        separator.connect('repaint', this._onVertSepRepaint.bind(this));
        return separator;
    }

    _onDestroy() {
        super._onDestroy();

        /* Main.overview.disconnect(this._showingId);
        Main.overview.disconnect(this._hidingId); */

        // appSys.disconnect(this._installedChangedId);

        this._tree.disconnect(this._treeChangedId);
        this._tree = null;

        Main.wm.setCustomKeybindingHandler('panel-main-menu',
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Main.sessionMode.hasOverview ?
                Main.overview.toggle.bind(Main.overview) :
                null
        );

        this._desktopTarget.destroy();
    }


    popup() {
        this.open();
    }


    _onVertSepRepaint(area) {

        const cr = area.get_context();
        const themeNode = area.get_theme_node();

        const [ width, height ] = area.get_surface_size();

        const stippleColor = themeNode.get_color('-stipple-color');
        const stippleWidth = themeNode.get_length('-stipple-width');

        const x = Math.floor(width / 2) + 0.5;

        cr.moveTo(x, 0);
        cr.lineTo(x, height);

        Clutter.cairo_set_source_color(cr, stippleColor);

        cr.setDash([ 1, 3 ], 1); // Hard-code for now
        cr.setLineWidth(stippleWidth);
        cr.stroke();
    }


    _onOpenStateChanged(open) {
        if (!this.mainBox)
            this._display();

        if (open) {
            if (this.reloadFlag) {
                this._redisplay();
                this.reloadFlag = false;
            }

            this.mainBox.show();
        }


        if (open)
            this.actor.add_style_pseudo_class('active');
        else
            this.actor.remove_style_pseudo_class('active');

        // Setting the max-height won't do any good if the minimum height of the
        // menu is higher then the screen; it's useful if part of the menu is
        // scrollable so the minimum height is smaller than the natural height
        const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const verticalMargins = this.actor.margin_top + this.actor.margin_bottom;

        // The workarea and margin dimensions are in physical pixels, but CSS
        // measures are in logical pixels, so make sure to consider the scale
        // factor when computing max-height
        const maxHeight = Math.round((workArea.height - verticalMargins) / scaleFactor);
        this.actor.style = 'max-height: %spx;'.format(maxHeight);


    }

    /*  _setKeybinding() {
         Main.wm.setCustomKeybindingHandler('panel-main-menu',
             Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
             () => this.toggle()
         );
     } */

    _redisplay() {
        this.removeAll();

        if (this.applicationsBox) this.applicationsBox.destroy_all_children();
        if (this.categoriesBox) this.categoriesBox.destroy_all_children();

        this._display();
    }

    _loadCategory(categoryId, dir) {
        const iter = dir.iter();

        const getNext = node => {
            if (node === GMenu.TreeItemType.INVALID)
                return;

            if (node === GMenu.TreeItemType.ENTRY) {
                const entry = iter.get_entry();
                let id;

                try {
                    id = entry.get_desktop_file_id(); // catch non-UTF8 filenames
                } catch (e) {
                    return getNext(iter.next());
                }

                let app = appSys.lookup_app(id);

                if (!app)
                    app = new Shell.App({ app_info: entry.get_app_info() });

                if (app.get_app_info().should_show())
                    this.applicationsByCategory[ categoryId ].push(app);

            } else if (node === GMenu.TreeItemType.SEPARATOR) {

                this.applicationsByCategory[ categoryId ].push('separator');

            } else if (node === GMenu.TreeItemType.DIRECTORY) {

                const subdir = iter.get_directory();

                if (!subdir.get_is_nodisplay())
                    this._loadCategory(categoryId, subdir);
            }

            getNext(iter.next());
        };

        getNext(iter.next());
    }

    scrollToButton(button) {

        const appsScrollBoxAdj = this.applicationsScrollBox.get_vscroll_bar().get_adjustment();
        const appsScrollBoxAlloc = this.applicationsScrollBox.get_allocation_box();
        const currentScrollValue = appsScrollBoxAdj.get_value();

        const boxHeight = appsScrollBoxAlloc.y2 - appsScrollBoxAlloc.y1;
        const buttonAlloc = button.get_allocation_box();
        let newScrollValue = currentScrollValue;

        if (currentScrollValue > buttonAlloc.y1 - 10)
            newScrollValue = buttonAlloc.y1 - 10;

        if (boxHeight + currentScrollValue < buttonAlloc.y2 + 10)
            newScrollValue = buttonAlloc.y2 - boxHeight + 10;

        if (newScrollValue !== currentScrollValue)
            appsScrollBoxAdj.set_value(newScrollValue);
    }

    scrollToCatButton(button) {

        const catsScrollBoxAdj = this.categoriesScrollBox.get_vscroll_bar().get_adjustment();
        const catsScrollBoxAlloc = this.categoriesScrollBox.get_allocation_box();
        const currentScrollValue = catsScrollBoxAdj.get_value();

        const boxHeight = catsScrollBoxAlloc.y2 - catsScrollBoxAlloc.y1;
        const buttonAlloc = button.get_allocation_box();

        let newScrollValue = currentScrollValue;

        if (currentScrollValue > buttonAlloc.y1 - 10)
            newScrollValue = buttonAlloc.y1 - 10;

        if (boxHeight + currentScrollValue < buttonAlloc.y2 + 10)
            newScrollValue = buttonAlloc.y2 - boxHeight + 10;

        if (newScrollValue !== currentScrollValue)
            catsScrollBoxAdj.set_value(newScrollValue);
    }


    _createLayout() {

        const section = new PopupMenu.PopupMenuSection();
        this.addMenuItem(section);


        this.mainBox = new St.BoxLayout({ vertical: false });
        this.leftBox = new St.BoxLayout({ vertical: true });

        this.applicationsScrollBox = new St.ScrollView({
            style_class: 'apps-menu vfade',
            x_expand: true,
        });


        this.applicationsScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        const appVscroll = this.applicationsScrollBox.get_vscroll_bar();

        appVscroll.connect('scroll-start', () => {
            this.passEvents = true;
        });

        appVscroll.connect('scroll-stop', () => {
            this.passEvents = false;
        });

        this.categoriesScrollBox = new St.ScrollView({
            style_class: 'vfade',
        });

        this.categoriesScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        const categoriesVscroll = this.categoriesScrollBox.get_vscroll_bar();

        categoriesVscroll.connect('scroll-start', () => (this.passEvents = true));
        categoriesVscroll.connect('scroll-stop', () => (this.passEvents = false));


        this.leftBox.add_child(this.categoriesScrollBox);

        this.applicationsBox = new St.BoxLayout({ vertical: true });
        this.applicationsScrollBox.add_actor(this.applicationsBox);
        this.categoriesBox = new St.BoxLayout({ vertical: true });
        this.categoriesScrollBox.add_actor(this.categoriesBox);

        this.mainBox.add(this.leftBox);
        this.mainBox.add_child(this._createVertSeparator());
        this.mainBox.add_child(this.applicationsScrollBox);
        section.actor.add_actor(this.mainBox);
    }


    _display() {
        this._tree = new GMenu.Tree({ menu_basename: 'applications.menu' });
        this._treeChangedId = this._tree.connect('changed', this._onTreeChanged.bind(this));
        this._createLayout();

        this._applicationsButtons.clear();
        this.mainBox.style = 'width: 35em;';
        this.mainBox.hide();

        // Load categories
        this.applicationsByCategory = {};
        this._tree.load_sync();

        let categoryMenuItem = new CategoryMenuItem(this, null);
        this.categoriesBox.add_actor(categoryMenuItem);

        const root = this._tree.get_root_directory();
        const iter = root.iter();

        const loadCategories = treeNode => {

            if (treeNode === GMenu.TreeItemType.INVALID)
                return;

            if (treeNode !== GMenu.TreeItemType.DIRECTORY)
                return loadCategories(iter.next());

            const dir = iter.get_directory();

            if (dir.get_is_nodisplay())
                return loadCategories(iter.next());

            const categoryId = dir.get_menu_id();
            this.applicationsByCategory[ categoryId ] = [];

            this._loadCategory(categoryId, dir);

            if (this.applicationsByCategory[ categoryId ].length > 0) {
                categoryMenuItem = new CategoryMenuItem(this, dir);
                this.categoriesBox.add_actor(categoryMenuItem);
            }

            return loadCategories(iter.next());
        };

        loadCategories(iter.next());

        // Load applications
        this._displayButtons(this._listApplications(null));

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const scaleFactor = themeContext.scale_factor;

        const categoriesHeight = this.categoriesBox.height / scaleFactor;
        const height = Math.round(categoriesHeight) + MENU_HEIGHT_OFFSET;

        this.mainBox.style += `height: ${height}px`;
    }




    selectCategory(dir) {
        this.applicationsBox.get_children().forEach(c => {
            if (c._delegate instanceof PopupMenu.PopupSeparatorMenuItem)
                c._delegate.destroy();
            else
                this.applicationsBox.remove_actor(c);
        });

        if (dir)
            this._displayButtons(this._listApplications(dir.get_menu_id()));
        else
            this._displayButtons(this._listApplications(null));
    }



    _displayButtons(apps) {
        for (let i = 0; i < apps.length; i++) {
            const app = apps[ i ];
            let item;

            if (app instanceof Shell.App)
                item = this._applicationsButtons.get(app);
            else
                item = new PopupMenu.PopupSeparatorMenuItem();

            if (!item) {
                item = new ApplicationMenuItem(this, app);
                item.setDragEnabled(this._desktopTarget.hasDesktop);
                this._applicationsButtons.set(app, item);
            }

            if (!item.get_parent())
                this.applicationsBox.add_actor(item);
        }
    }

    _listApplications(categoryMenuId) {
        if (categoryMenuId)
            return this.applicationsByCategory[ categoryMenuId ];

        return global.settings.get_strv('favorite-apps')
            .map(id => appSys.lookup_app(id))
            .filter(app => app);
    }
};


// eslint-disable-next-line vars-on-top,no-var
var DashToPanelApplicationsMenu = Menu; // only variables defined with "var" are exported with GJS