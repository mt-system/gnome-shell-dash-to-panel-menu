
/**
 * Extend AppIconMenu
 *
 * - set popup arrow side based on taskbar orientation
 * - Add close windows option based on quitfromdash extension
 *   (https://github.com/deuill/shell-extension-quitfromdash)
 */

const AppDisplay = imports.ui.appDisplay;
const PopupMenu = imports.ui.popupMenu;
const Lang = imports.lang;
const Signals = imports.signals;


const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

/* logError(new Error('1111111111'));
log('2222222222222');
log(AppDisplay.AppIconMenu);
log('333333333');
log(AppDisplay); */

var Menu = Utils.defineClass({
    Name: 'DashToPanel.SecondaryMenu',
    Extends: AppDisplay.AppIconMenu,
    ParentConstrParams: [ [ 0 ] ],

    _init: function (source, panel) {
        // Damm it, there has to be a proper way of doing this...
        // As I can't call the parent parent constructor (?) passing the side
        // parameter, I overwite what I need later
        this.callParent('_init', source);

        let side = panel.getPosition();
        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;
    },

    // helper function for the quit windows abilities
    _closeWindowInstance: function (metaWindow) {
        metaWindow.delete(global.get_current_time());
    },

    _dtpRedisplay: function (parentFunc) {
        this.callParent(parentFunc);

        // Remove "Show Details" menu item
        if (!Me.settings.get_boolean('secondarymenu-contains-showdetails')) {
            let existingMenuItems = this._getMenuItems();
            for (let idx in existingMenuItems) {
                if (existingMenuItems[ idx ].actor.label_actor.text == _("Show Details")) {
                    this.box.remove_child(existingMenuItems[ idx ].actor);
                    if (existingMenuItems[ idx - 1 ] instanceof PopupMenu.PopupSeparatorMenuItem)
                        this.box.remove_child(existingMenuItems[ idx - 1 ].actor);
                    break;
                }
            }
        }

        // prepend items from the appMenu (for native gnome apps)
        if (Me.settings.get_boolean('secondarymenu-contains-appmenu')) {
            let appMenu = this._source.app.menu;
            if (appMenu) {
                let remoteMenu = new imports.ui.remoteMenu.RemoteMenu(this._source.actor, this._source.app.menu, this._source.app.action_group);
                let appMenuItems = remoteMenu._getMenuItems();
                for (var i = 0, l = appMenuItems.length || 0; i < l; ++i) {
                    let menuItem = appMenuItems[ i ];
                    let labelText = menuItem.actor.label_actor.text;
                    if (labelText == _("New Window") || labelText == _("Quit"))
                        continue;

                    if (menuItem instanceof PopupMenu.PopupSeparatorMenuItem)
                        continue;

                    // this ends up getting called multiple times, and bombing due to the signal id's being invalid
                    // on a 2nd pass. disconnect the base handler and attach our own that wraps the id's in if statements
                    menuItem.disconnect(menuItem._popupMenuDestroyId);
                    menuItem._popupMenuDestroyId = menuItem.connect('destroy', Lang.bind(this, function (menuItem) {
                        if (menuItem._popupMenuDestroyId) {
                            menuItem.disconnect(menuItem._popupMenuDestroyId);
                            menuItem._popupMenuDestroyId = 0;
                        }
                        if (menuItem._activateId) {
                            menuItem.disconnect(menuItem._activateId);
                            menuItem._activateId = 0;
                        }
                        if (menuItem._activeChangeId) {
                            menuItem.disconnect(menuItem._activeChangeId);
                            menuItem._activeChangeId = 0;
                        }
                        if (menuItem._sensitiveChangeId) {
                            menuItem.disconnect(menuItem._sensitiveChangeId);
                            menuItem._sensitiveChangeId = 0;
                        }
                        this.disconnect(menuItem._parentSensitiveChangeId);
                        if (menuItem == this._activeMenuItem)
                            this._activeMenuItem = null;
                    }));

                    menuItem.actor.get_parent().remove_child(menuItem.actor);
                    if (menuItem instanceof PopupMenu.PopupSubMenuMenuItem) {
                        let newSubMenuMenuItem = new PopupMenu.PopupSubMenuMenuItem(labelText);
                        let appSubMenuItems = menuItem.menu._getMenuItems();
                        for (let appSubMenuIdx in appSubMenuItems) {
                            let subMenuItem = appSubMenuItems[ appSubMenuIdx ];
                            subMenuItem.actor.get_parent().remove_child(subMenuItem.actor);
                            newSubMenuMenuItem.menu.addMenuItem(subMenuItem);
                        }
                        this.addMenuItem(newSubMenuMenuItem, i);
                    } else
                        this.addMenuItem(menuItem, i);
                }

                if (i > 0) {
                    let separator = new PopupMenu.PopupSeparatorMenuItem();
                    this.addMenuItem(separator, i);
                }
            }
        }

        // quit menu
        let app = this._source.app;
        let window = this._source.window;
        let count = window ? 1 : getInterestingWindows(app).length;
        if (count > 0) {
            this._appendSeparator();
            let quitFromTaskbarMenuText = "";
            if (count == 1)
                quitFromTaskbarMenuText = _("Quit");
            else
                quitFromTaskbarMenuText = _("Quit") + ' ' + count + ' ' + _("Windows");

            this._quitfromTaskbarMenuItem = this._appendMenuItem(quitFromTaskbarMenuText);
            this._quitfromTaskbarMenuItem.connect('activate', Lang.bind(this, function () {
                let app = this._source.app;
                let windows = window ? [ window ] : app.get_windows();
                for (i = 0; i < windows.length; i++) {
                    this._closeWindowInstance(windows[ i ]);
                }
            }));
        }
    }
});


const menuRedisplayFunc = !!AppDisplay.AppIconMenu.prototype._rebuildMenu ? '_rebuildMenu' : '_redisplay';

function adjustMenuRedisplay(menuProto) {
    menuProto[ menuRedisplayFunc ] = function () { this._dtpRedisplay(menuRedisplayFunc); };



}


Signals.addSignalMethods(Menu.prototype);
adjustMenuRedisplay(Menu.prototype);
