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
/**
 * @fileOverview utility functions
*/

"use strict";


require.scopes["adsidebarutils"] = (function()
{
    let exports = {};

    // LOCAL FUNCTIONS


    // EXPORTED FUNCTIONS

    let AdsidebarUtils = exports.AdsidebarUtils =
    {

        /**
         * findNode 
         *  - based on tagType and src
         */
        findNode : function(adsidebar, tagType, src) 
        {

            let wnd = adsidebar.wnd;
            let doc = wnd.document;
            let ads = adsidebar.ads;

            let nodeArray = doc.querySelectorAll(tagType);

            if (!nodeArray || (nodeArray.length == 0)) {
                return null;
            }

            let foundNode = null;
            for (let j = 0; j < nodeArray.length; j++) {
                if (src == nodeArray[j].src) {
                    // make sure the node is not already in the adsidebar container DIV.
                    if (!ads.adContainerDiv || (ads.adContainerDiv && !ads.adContainerDiv.contains(nodeArray[j]))) {
                        foundNode = nodeArray[j];
                        break;
                    }
                }
            }        
            
            return foundNode;
        },

        
    };
    
  return exports;
})();
    
