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
 * @fileOverview Adsidebar implementation
*/

"use strict";

require.scopes["adsidebar"] = (function()
{
    let exports = {};

    let Ads = require("ads").Ads;
    let NodeQueue = require("nodequeue").NodeQueue;
    
    /**
     * Contains adsidebar object mapped by window object
     * @type Map.<adsidebar,window>
     */
    let adsidebarMap = new Map();

    // adsidebar.state
    const ADSIDEBAR_STATE_INIT                   = 0;
    const ADSIDEBAR_STATE_WINDOW_LOAD            = 1;
    const ADSIDEBAR_STATE_PROCESS_NODES_START    = 2;
    const ADSIDEBAR_STATE_PROCESS_NODES_COMPLETE = 3;       // all nodes moved to adsidebar DIV
    const ADSIDEBAR_STATE_ADLOAD_START           = 4;       // wait for sidebar DIV nodes to load resources  
    const ADSIDEBAR_STATE_ADLOAD_COMPLETE        = 5;       // display adsidebar DIV
    const ADSIDEBAR_STATE_DONE                   = 6;       // done - assume all sidebar ads are loaded and     
                                                            // dynamic ad processing can commence
                                                            
                                                            
    let adsidebar_prefs = {
        enabled : null,
        adsidebar_autohide : null,      // seconds, 0 is disabled
        adsidebar_adScaling : null,
    };
                                                                
    // MESSAGE HANDLING
    
    chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type == "adsidebar-should-load-request") {
            let type = request.resourceType;
            let url = request.resourceUrl;

            Adsidebar.processPolicyResponse(type, url);
        }
    });
    

    chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type == "adsidebar-update-child-prefs") {
            
            adsidebar_prefs.enabled = request.enabled;
            adsidebar_prefs.adsidebar_autohide = request.adsidebar_autohide;
            adsidebar_prefs.adsidebar_adScaling = request.adsidebar_adScaling;
        }
    });


    chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type == "adsidebar-toggle-sidebar") {

            let wnd = window.top;
            if (wnd) {
                let adsidebar = adsidebarMap.get(wnd);
                if (adsidebar) {
                    if (adsidebar.sidebarDisplayed) {
                        hideSidebar(adsidebar);
                    } else {
                        showSidebar(adsidebar);
                    }
                }    
            }
            
        }
    });

    chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type == "adsidebar-data-request") {

            let wnd = window.top;
            
            if (wnd) {
                let data = {
                    sidebarEnabled : false,
                    sidebarDisplayed : false,
                };
                
                let adsidebar = adsidebarMap.get(wnd);
                if (adsidebar) {
                    data.sidebarEnabled = adsidebar.ads.stats.numAds ? true : false;
                    data.sidebarDisplayed = adsidebar.sidebarDisplayed;
                }
                
                sendResponse(data);
            }
        }   
    });

    // LOCAL FUNCTIONS

    /**
     * windowInit
     */
    function windowInit(wnd)
    {
        
        if (wnd != wnd.top) {
            return;
        }
        
        if (adsidebarMap.has(wnd)) {
            return;
        }
                
        // create new adsidebar object. Map window top => adsidebar object
        adsidebarMap.set(wnd,
                            {
                                wnd  : wnd,
                                ads  : null,                // for use by Ads module
                                sidebarDiv : null,          // div that holds title menu + adDiv
                                titleIFrame : null,         // title menu (iframe)
                                sidebarExpanded : false,
                                sidebarDisplayed : false,
                                timeoutId : null,           // timeout for closing sidebar       
                                maxWidth : 800,
                                maxHeight : 600,
                                state : ADSIDEBAR_STATE_INIT,  
                                
                                nodeQueue : [],            // blocked nodes (e.g. script nodes)
                                lastScriptNode : null,     // "load" event bound to this node
                                scriptErrorFlag : false, 
                                handleScriptError : false,
                                refreshgpt : false,
                                runlocalscripts : false,
                                overridejqueryready : false,
                                documentWriteString : "",
                                currentScriptDiv : null,
                                
                                notifyNodeQueueComplete : null,
                                notifyAdLoadingStarted : null,
                                notifyAdLoadingComplete : null,
                                                            
                                stats : {
                                    numDocWrites : 0,
                                    numDeadNodes : 0,
                                }    
                            });
        
        wnd.addEventListener("load", windowLoad.bind(this, wnd), false);
        
        // document "load" event doesn't work, but DOMContentLoaded and readystatechange do.
        // For debug purposes.
        wnd.document.addEventListener("DOMContentLoaded", 
            function (wnd) {
            }.bind(this, wnd), false);
        
        wnd.document.addEventListener("readystatechange", 
                function (wnd) {
                }.bind(this, wnd), false);        
        
        wnd.addEventListener("unload", windowUnload.bind(this, wnd), false);
        wnd.addEventListener("error", windowError.bind(this, wnd), false);

        let adsidebar = adsidebarMap.get(wnd);
        
        if (adsidebar) {
            
            // get adsidebar options
            ext.backgroundPage.sendMessage(
                {
                    type: "adsidebar-get-child-prefs"
                },

                function(response)
                {
                    if (response) {
                        
                        adsidebar_prefs.enabled = response.enabled;
                        adsidebar_prefs.adsidebar_autohide = response.adsidebar_autohide;
                        adsidebar_prefs.adsidebar_adScaling = response.adsidebar_adScaling;
                    }
                }
            );
            
            // get URL specific options specificied in Adsidebar EasyList Supplement subscription. 
            ext.backgroundPage.sendMessage(
                {
                    type: "adsidebar-get-url-info",
                    location: wnd.document.URL,
                },

                function(response)
                {
                    if (response) {
                        adsidebar.refreshgpt = response.refreshgpt;
                        adsidebar.runlocalscripts = response.runlocalscripts;
                        adsidebar.overridejqueryready = response.overridejqueryready;
                        
                    }
                }
            );
            
        }
        
        // init ads module
        Ads.windowInit(adsidebar);
        
        // register notification functions
        adsidebar.notifyNodeQueueComplete = function (adsidebar) { 
                    adsidebar.state = ADSIDEBAR_STATE_PROCESS_NODES_COMPLETE;
                }.bind(this, adsidebar);
                
        adsidebar.notifyAdLoadingStarted =  function (adsidebar) { 
                    adsidebar.state = ADSIDEBAR_STATE_ADLOAD_START;
                }.bind(this, adsidebar);
                
        adsidebar.notifyAdLoadingComplete =  function (adsidebar) { 
                    adLoadingComplete(adsidebar);
                }.bind(this, adsidebar);
                
    }

    /**
     * windowLoad   
     */
    function windowLoad(wnd)
    {

        let doc = wnd.document;
        
        if (!doc) {
            return;
        }

        let adsidebar = adsidebarMap.get(wnd);
        if (!adsidebar) {
            return;
        }

        // new state declares that nodes should no longer be blocked
        // this allows ad script to be loaded
        adsidebar.state = ADSIDEBAR_STATE_WINDOW_LOAD;

        // create sidebar
        createSidebar(adsidebar);

        // notify background page (i.e. main extension process) that the window is loaded
        // and not to block ads.
        ext.backgroundPage.sendMessage({type: "adsidebar-allow-web-requests"}, function(response)
        {
            
            // notify ads module that the document has loaded
            // - note Ads.windowLoad is now asynchronous 
            
            Ads.windowLoad(adsidebar.ads, function () {
                adsidebar.state = ADSIDEBAR_STATE_PROCESS_NODES_START;
                
                // notify NodeQueue module that the document has loaded
                //  - will override document.write
                NodeQueue.windowLoad(adsidebar);
                
                // Process blocked node queue sequentially
                //      - dequeue node (e.g. script node)
                //      - create new script node. Add "load" event listener.
                //      - On "load" event
                //              dequeue next node
                //              if no more nodes, call processNodeQueueComplete()
                if (adsidebar.nodeQueue.length) {
                    NodeQueue.processNodeQueue(adsidebar);
                } 
            });
        });        
    }

    /**
     * windowUnload
     */
    function windowUnload(wnd)
    {

        // notify background page (i.e. main extension process) that the window is unloaded
        // and to block ads agains.
        ext.backgroundPage.sendMessage({type: "adsidebar-disallow-web-requests"});

        let adsidebar = adsidebarMap.get(wnd);

        if (adsidebar) {
            // notify ads module
            Ads.windowUnload(adsidebar.ads);
        }        
        
        adsidebarMap.delete(wnd);
    }

    /**
     * windowError
     */
    function windowError(wnd, e)
    {

        let adsidebar = adsidebarMap.get(wnd);

        // record error.  Likely a script error (undefined variable or function)        
        if (adsidebar) {
            adsidebar.scriptErrorFlag = true;
        }
    }

    /**
     * hideSidebar
     */
    function hideSidebar(adsidebar)
    {
        // hide adsidebar div
        if (adsidebar.sidebarExpanded) {
            adsidebar.sidebarDiv.style.right = -adsidebar.maxWidth + 'px';
        } else {
            adsidebar.sidebarDiv.style.right = -adsidebar.ads.adBoxWidth + 'px';
        }
        adsidebar.sidebarDisplayed = false;
    }

    /**
     * showSidebar
     */
    function showSidebar(adsidebar)
    {
        // show adsidebar div
        adsidebar.sidebarDisplayed = true;
        adsidebar.sidebarDiv.style.right = '0px';
    }



    /**
     * createSidebar
     */
    function createSidebar(adsidebar)
    {
        
        let wnd = adsidebar.wnd;
        let doc = wnd.document;

        // Create sidebar 
        //
        // Sidebar is composed of the following DIVs
        //
        //      sidebarDiv
        //          titleIFrame
        //          adContainerDiv
        //
        let sidebarDiv = doc.createElement('div');
        
        sidebarDiv.id = 'adsidebar_container';
        
        let bkColor = wnd.getComputedStyle(doc.body, null).backgroundColor;
        if (!bkColor || bkColor == 'transparent') {
            bkColor = 'white';
        } else if (bkColor.startsWith('rgba')) {
            let bkColorArray = bkColor.split(',');
            let alpha = parseInt(bkColorArray[3]);
            if (alpha == 0) {
                bkColor = 'white';
            }
        }
        sidebarDiv.style.backgroundColor = bkColor;
        sidebarDiv.style.position = 'fixed';
        sidebarDiv.style.right = -adsidebar.maxWidth + 'px'      // negative is off-screen
        sidebarDiv.style.top = '0px';
        sidebarDiv.style.width = adsidebar.maxWidth + 'px';
        sidebarDiv.style.height = 'auto';
        sidebarDiv.style.overflow = 'hidden';
        sidebarDiv.style.zIndex = 2147483647; //Number.MAX_SAFE_INTEGER;
                                    
        sidebarDiv.style.transition = 'right 1s';      // animation
        
        // add title bar
        let request = new XMLHttpRequest();
        request.open("GET", chrome.extension.getURL('/adsidebar/resources/adsidebar_title.html'), false);
        request.send();
        
        if (request.responseText) {
            let titleIFrame = doc.createElement('iframe');
            
            // on iframe load, add event listners to buttons
            titleIFrame.addEventListener("load", 
                function(adsidebar) {

                    // load initial icons
                    let titleImg = titleIFrame.contentDocument.querySelector("#icon_title");
                    if (titleImg) {
                        titleImg.src = chrome.extension.getURL("adsidebar/resources/adsidebar-icon.png");
                    }

                    let expandImg = titleIFrame.contentDocument.querySelector("#icon_expand");
                    if (expandImg) {
                        expandImg.src = chrome.extension.getURL("adsidebar/resources/adsidebar-icon-expand.png");
                    }
                    
                    let closeImg = titleIFrame.contentDocument.querySelector("#icon_delete");
                    if (closeImg) {
                        closeImg.src = chrome.extension.getURL("adsidebar/resources/adsidebar-icon-delete.png");
                    }
                    
                    
                    // style iframe
                    titleIFrame.width = adsidebar.ads.adBoxWidth + "px";
                    titleIFrame.height = titleIFrame.contentDocument.body.clientHeight + "px";
                    titleIFrame.style.margin = "0px";
                    titleIFrame.style.border = "0px";
                    titleIFrame.style.width = adsidebar.ads.adBoxWidth + "px";
                    titleIFrame.style.height = titleIFrame.contentDocument.body.clientHeight + "px";

                    // style iframe.document                    
                    titleIFrame.contentDocument.body.style.overflow = "hidden";

                    // if sidebar width is small, remove title text                    
                    if (adsidebar.ads.adBoxWidth < 150) {
                        let titleTextNode = titleIFrame.contentDocument.querySelector("#adsidebar_title_text");
                        titleTextNode.parentElement.removeChild(titleTextNode);
                    }
                    
                    // add event listeners to buttons
                    let closeButton = titleIFrame.contentDocument.querySelector("#adsidebar_close_button");
                    if (closeButton) {
                        closeButton.addEventListener("click",
                            function (adsidebar) {
                                hideSidebar(adsidebar);
                            }.bind(this, adsidebar), false);
                    }
                    
                    let expandButton = titleIFrame.contentDocument.querySelector("#adsidebar_expand_button");
                    if (expandButton) {
                        expandButton.addEventListener("click",
                            function (adsidebar) {
                                
                                if (adsidebar.sidebarExpanded) {
                                    // collapse the sidebar
                                    adsidebar.sidebarExpanded = false;

                                    sidebarDiv.style.width = adsidebar.ads.adBoxWidth + "px";
                                    titleIFrame.width = adsidebar.ads.adBoxWidth + "px";
                                    titleIFrame.style.width = adsidebar.ads.adBoxWidth + "px";;
                    
                                    let expandImg = titleIFrame.contentDocument.querySelector("#icon_expand");
                                    if (expandImg) {
                                        expandImg.src = chrome.extension.getURL("adsidebar/resources/adsidebar-icon-expand.png");
                                    }

                                    // style ad dividers
                                    Ads.notifySidebarCollapsed(adsidebar.ads);
                                    
                                } else {
                                    // expand the sidebar
                                    adsidebar.sidebarExpanded = true;

                                    adsidebar.sidebarDiv.style.width = adsidebar.maxWidth + 'px';
                                    titleIFrame.width = adsidebar.maxWidth + 'px';
                                    titleIFrame.style.width = adsidebar.maxWidth + "px";;

                                    // change button to collapse image
                                    let expandImg = titleIFrame.contentDocument.querySelector("#icon_expand");
                                    if (expandImg) {
                                        expandImg.src = chrome.extension.getURL("adsidebar/resources/adsidebar-icon-collapse.png");
                                    }

                                    // style ad dividers
                                    Ads.notifySidebarExpanded(adsidebar.ads);
                                }
                                
                            }.bind(this, adsidebar), false);
                    }

                }.bind(this, adsidebar), false);
            
            // append title iframe to adsidebar DIV
            titleIFrame.srcdoc = request.responseText;
            
            sidebarDiv.appendChild(titleIFrame);
            adsidebar.titleIFrame = titleIFrame;
        }
        
        // insert sidebar DIV into DOM
        doc.body.insertBefore(sidebarDiv, doc.body.firstChild);
        adsidebar.sidebarDiv = sidebarDiv;
            
    }


    /**
     * adLoadingComplete
     */
    function adLoadingComplete(adsidebar)
    {
        let wnd = adsidebar.wnd;

        adsidebar.state = ADSIDEBAR_STATE_ADLOAD_COMPLETE;

        // when hidden, sidebar DIV is 800px wide.  Set to correct width before unhiding.
            
        if (adsidebar.sidebarExpanded) {
            adsidebar.sidebarDiv.style.width = adsidebar.maxWidth + 'px';
            
        } else {
            adsidebar.sidebarDiv.style.width = adsidebar.ads.adBoxWidth + "px";
        }
        
        // show adsidebar div
        showSidebar(adsidebar);
        
        // some websites modify this. Make sure zIndex is correct.
        adsidebar.sidebarDiv.style.zIndex = 2147483647;

        // automatically hide the sidebar after a specified number of seconds 
        let timeoutMsec = adsidebar_prefs.adsidebar_autohide * 1000;
        if (timeoutMsec) {
        function hideSidebarTimeout() 
        {
                adsidebar.sidebarDiv.removeEventListener("mouseover", mouseoverEventFunc, false);
                adsidebar.sidebarDiv.removeEventListener("mouseout", mouseoutEventFunc, false);
            
                // hide adsidebar div
                hideSidebar(adsidebar);
            };

            // start timeout  (restart if timeout in progress)
            if (adsidebar.timeoutId) {
                adsidebar.wnd.clearTimeout(adsidebar.timeoutId);
            }
            adsidebar.timeoutId = wnd.setTimeout(hideSidebarTimeout.bind(this), timeoutMsec);

            // cancel timeout if user moves mouse over adsidebar
            function mouseoverEventFunc() 
            {
                adsidebar.wnd.clearTimeout(adsidebar.timeoutId);
                adsidebar.timeoutId = null;
            };
            adsidebar.sidebarDiv.addEventListener("mouseover", mouseoverEventFunc, false);
            
            // restart timeout if user moves mouse out of adsidebar
            function mouseoutEventFunc() {
                adsidebar.timeoutId = wnd.setTimeout(hideSidebarTimeout.bind(this), timeoutMsec);
            };
            adsidebar.sidebarDiv.addEventListener("mouseout", mouseoutEventFunc, false);
        }       
        
        adsidebar.state = ADSIDEBAR_STATE_DONE;
        logDebugInfo(adsidebar); 
        
    } 

    /**
     * logDebugInfo
     */
    function logDebugInfo (adsidebar) 
    {
        
    }


    // EXPORTED FUNCTIONS

    let Adsidebar = exports.Adsidebar =
    {
        adsidebar_prefs : adsidebar_prefs,
        
        /**
         * init
         */
        init: function()
        {
            
            windowInit(window);
            
        },


        /**
         * Processes parent's response to the ShouldAllow message.
         */
        processPolicyResponse : function(type, url)
        {  
            let wnd = window;
            
            if (!adsidebar_prefs.enabled) {
                return allow;
            }
            //
            //
            //
            //
            //

            //
            //
            
            let wndtop = wnd.top;
            
            if (!adsidebarMap.has(wndtop)) {
                
                return;
            }

            let adsidebar = adsidebarMap.get(wndtop);

            // convert type to tag type usable in createElement
            let tagType = type;
            switch (type) {
                case "SUBDOCUMENT":
                    tagType = "iframe";
                    break;
                case "IMAGE":
                    tagType = "img";
                    break;
                default:
                    break;
            }


            if (adsidebar.state >= ADSIDEBAR_STATE_WINDOW_LOAD) {
                    
                // After window loads
                // - allow new nodes to load so that ads display correctly 
                // - dynamic ad support (e.g. ads insert after page loaded)
                //      check for filter = elemhide, find new nodes, move to adsidebar
                
    
                if (adsidebar.state >= ADSIDEBAR_STATE_ADLOAD_COMPLETE) {
                    // dynamic ad processing
                    let nodeInfo = {
                        type,
                        tagType,
                        url
                    };
                    
                    Ads.insertNewNodeDynamic(adsidebar.ads, nodeInfo);
                }
                
            } else {
                // state < ADSIDEBAR_STATE_WINDOW_LOAD
                //      Before page loads, queue and block all nodes.
                //      The nodes will be reinserted after the page loads.
                
                // If script node, instead of storing reference to node,
                // store script information.
                // On some websites, the script node's parent is the document.head
                // and when the script does not load, the script node is deleted.
                // Any subsequent references become "cannot access dead node".
                // To fix this
                //    - Copy script information, rather than store a reference to the script node.
                // The is ok for script nodes as a new script node must be allocated anyway 
                // for the script to run again.  If the node is simply append to the DOM, the script
                // will not run.    
                
                let nodeInfo = {
                    type,
                    tagType,
                    url
                };
                
                adsidebar.nodeQueue.push(nodeInfo);
            }
        },
        
    };

    Adsidebar.init();
    
  return exports;
})();
    