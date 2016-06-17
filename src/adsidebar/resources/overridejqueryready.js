/*
 * This file is part of AdSidebar <https://adblockplus.org/>,
 * Copyright (C) 2016 Paul Shaw
 *
 * AdSidebar is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * AdSidebar is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with AdSidebar.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

// override jquery ready
// - force it to re-run when script error occurs when loading nodes after page loaded.
if (window.jQuery) {
    window.jQuery.fn.ready = function(fn) {
        fn();
    };
    window.postMessage({  type : "ADSIDEBAR-override-jquery-ready-response"}, '*');
}
