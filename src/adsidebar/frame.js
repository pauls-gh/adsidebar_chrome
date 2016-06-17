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

// iframe script
//  - receive message from content script
//  - return iframe information
//
// Note this is necessary because of security restrictions
// that prevent the content script accessing an iframe's window or document objects 

(function()
{
    // Called sometime after postMessage is called
    function receiveMessage(event)
    {
        if (event.data.type == "ADSIDEBAR-get-iframe-info") {
            
            event.source.postMessage(
                {   type : "ADSIDEBAR-get-iframe-info-response",
                    readyState : window.document.readyState,
                    width : window.document.body.offsetWidth,
                    height : window.document.body.offsetHeight,
                },
                event.origin);
        }   
    }
    
    function startMessageListener()
    {
        window.removeEventListener("message", receiveMessage, false);
        window.addEventListener("message", receiveMessage, false);

        // for some reason, the message listener is sometimes removed from the iframe.
        // (possibly due to removing the iframe node from the DOM?)
        // to workaround this, periodically add the message listener
        window.setTimeout(startMessageListener, 500);
        
    }

    startMessageListener();

})();
