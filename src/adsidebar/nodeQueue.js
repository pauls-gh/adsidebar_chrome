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


require.scopes["nodequeue"] = (function()
{
    let exports = {};

    let Ads = require("ads").Ads;
    let AdsidebarUtils = require("adsidebarutils").AdsidebarUtils;

    // LOCAL FUNCTIONS

    /**
     * handleScriptError
     */
    function handleScriptError(adsidebar)
    {

        if (!adsidebar.scriptErrorFlag) {
            return;
        }

        if (adsidebar.handleScriptError) {
            return;
        }

        adsidebar.handleScriptError = true;
        
        let wnd = adsidebar.wnd;
        let doc = wnd.document;

        // override jquery first (async), then run local scripts.
        overrideJqueryReady(adsidebar, function (adsidebar) {

            if (adsidebar.runlocalscripts) {
                let scriptArray = [];
                
                // if script error occurred, re-run inline scripts.
                // The error is most likely due to prior blocking of external script loading.

                let elementList = doc.getElementsByTagName("script");
                for (let i = 0; i < elementList.length; i++) { 
                    let scriptNode = elementList[i];
                    if (!scriptNode.src) {
                        scriptArray.push(scriptNode);
                    }
                }
                
                for (let scriptNode of scriptArray) {
                    // for the script node to be excecuted again, must create a new script node
                    let scriptNew   = doc.createElement("script");
                    scriptNew.type  = scriptNode.type;
                    scriptNew.async = scriptNode.async;
                    scriptNew.innerHTML = scriptNode.innerHTML;
                    
                    // insert new div node into ad container DIV
                    Ads.insertNewNode(adsidebar.ads, scriptNew);
                }      
            }        

            if (adsidebar.refreshgpt) {
                
                // refresh GPT ads if script error occurred
                // to access window.googletab, must insert new script into the DOM.
                let script = doc.createElement('script');
                script.src = chrome.extension.getURL('/adsidebar/resources/refreshgpt.js');
                adsidebar.ads.adContainerDiv.appendChild(script);                    
            }        
        });
    }    


    /**
     * overrideJqueryReady (async)
     */
    function overrideJqueryReady(adsidebar, callback)
    {
        let wnd = adsidebar.wnd;
        let doc = wnd.document;
        
        function messageListener(event)
        {
            
            if (event.data.type == "ADSIDEBAR-override-jquery-ready-response") {
                
                wnd.removeEventListener("message", messageListener, false);

                if (callback) {
                    callback(adsidebar);
                }
            }
        }

        if (!adsidebar.overridejqueryready) {
            if (callback) {
                callback(adsidebar);
            }
            return;
        } 
        
        wnd.addEventListener("message", messageListener, false);

        // override jquery ready
        let script = doc.createElement('script');
        script.src = chrome.extension.getURL('/adsidebar/resources/overridejqueryready.js');
        adsidebar.ads.adContainerDiv.appendChild(script);                    


    }    

    /**
     * nodeAddEventListeners
     */
    function nodeAddEventListeners(adsidebar, node) 
    {
        if (adsidebar.lastScriptNode) {
            nodeRemoveEventListeners(adsidebar, adsidebar.lastScriptNode);            
        }
        
        adsidebar.lastScriptNode = node;
        
        node.addEventListener("load", nodeLoaded.bind(this, adsidebar, node), false);
        node.addEventListener("error", nodeError.bind(this, adsidebar, node), false);
    }

    /**
     * nodeRemoveEventListeners
     */
    function nodeRemoveEventListeners(adsidebar, node) 
    {
        // remove event listeners
        node.removeEventListener("load", nodeLoaded, false);
        node.removeEventListener("error", nodeError, false);
        
        adsidebar.lastScriptNode = null;
    }
        
    /**
     * nodeLoaded
     */
    function nodeLoaded(adsidebar, node) 
    {
                
        nodeRemoveEventListeners(adsidebar, node)
        
        NodeQueue.processNodeQueue(adsidebar);
    }

    /**
     * nodeError
     */
    function nodeError(adsidebar, node) 
    {
        
        nodeRemoveEventListeners(adsidebar, node)
        
        NodeQueue.processNodeQueue(adsidebar);
    }

    /**
     * processNodeQueueComplete
     */
    function processNodeQueueComplete(adsidebar)
    {
        
        adsidebar.notifyNodeQueueComplete(adsidebar);
                
        
        adsidebar.notifyAdLoadingStarted(adsidebar);
        
        // handle any script errors
        handleScriptError(adsidebar);
    }
    

    // EXPORTED FUNCTIONS

    let NodeQueue = exports.NodeQueue =
    {
        /**
         * windowLoad
         */
        windowLoad : function (adsidebar)
        {
            let wnd = adsidebar.wnd;
            let doc = wnd.document;
            
            // Override document.write 
            //
            // This is needed as some scripts create elements using document.write,
            // but document.write is a no-op after the page is loaded.
            // Must create new script to modify document.write,
            //  as we can't access window.document.write of the original page.                
            let script = doc.createElement('script');
            script.src = chrome.extension.getURL('/adsidebar/resources/overridedocwrite.js');
            adsidebar.ads.adContainerDiv.appendChild(script);                    
            
            // listen for document.write notifications from page  (document.write is overridden)
            function messageListener(event)
            {
                
                if (event.data.type == "ADSIDEBAR-document-write-notification") {
                    let str = event.data.str;
            
                    adsidebar.stats.numDocWrites++;

                    adsidebar.documentWriteString += str;
                                    
                    // script will not run if insertAdjacentHTML is used (even with defer = true)
                    // use createContextualFragment instead
                    let range = doc.createRange();
                    let docFragmentToInsert = range.createContextualFragment(adsidebar.documentWriteString);

                    if (docFragmentToInsert.childNodes.length == 0) {
                        // no valid nodes, assume document.write will be called again
                    } else {
                        // valid nodes
                        
                        adsidebar.documentWriteString = "";
                                                
                        // insert into current script div
                        adsidebar.currentScriptDiv.appendChild(docFragmentToInsert);
                        
                        // add dummy <script> which will be used to add a "load" event listener
                        // which will signal the document fragment has loaded.

                        let dummyScriptStr = "<script></script>";
                        range = doc.createRange();
                        docFragmentToInsert = range.createContextualFragment(dummyScriptStr);
                        
                        // add event listener to dummy script node
                        nodeAddEventListeners(adsidebar, docFragmentToInsert.firstElementChild);

                        // insert into current script div
                        adsidebar.currentScriptDiv.appendChild(docFragmentToInsert);
                    }
                
                }
            }
            
            wnd.addEventListener("message", messageListener, false);
        },

        /**
         * processNodeQueue
         */
        processNodeQueue : function (adsidebar)
        {
            
            let wnd = adsidebar.wnd;
            if (!wnd) {
                return;
            }
            
            
            let doc = wnd.document;
        
            if (!doc) {
                return;
            }
            
            // dequeue node
            let nodeInfo = adsidebar.nodeQueue.shift();
        
            if (!nodeInfo) {
                // we're done
                processNodeQueueComplete(adsidebar);
                return;            
            }
        
            if (nodeInfo.type != "SCRIPT") {
                // non-script node

                if (nodeInfo.type == "SUBDOCUMENT") {
                    // process iframe

                    let node = AdsidebarUtils.findNode(adsidebar, nodeInfo.tagType, nodeInfo.url);

                    if (node) {
                        // add event listener to execute when script loaded
                        // - will dequeue the next node
                        nodeAddEventListeners(adsidebar, node);

                    } else {
                        let node   = doc.createElement("iframe");

                        // add event listener to execute when script loaded
                        // - will dequeue the next node
                        nodeAddEventListeners(adsidebar, node);
                        
                        node.src   = nodeInfo.url;
                    }
                    
                    // insert node into ad container div
                    Ads.insertNewNode(adsidebar.ads, node);
                    
                } else {

                    let node = AdsidebarUtils.findNode(adsidebar, nodeInfo.tagType, nodeInfo.url);

                    if (!node) {
                        node = doc.createElement(nodeInfo.tagType);
                        if (node) {
                            node.src = nodeInfo.url;
                        }
                    } else {
                        if (nodeInfo.type == "IMAGE") {
                            // add cache busting to force image to reload
                            node.src += '?adsidebar';
                        }
                    }
                    
                    if (!node) {
                    } else {
                        // insert node into ad container div
                        Ads.insertNewNode(adsidebar.ads, node);
                    }
                    
                    // process next node in the queue
                    this.processNodeQueue(adsidebar);
                }
                
            } else {
                
                // script node

                // for the script node to be excecuted again, must create a new script node
                let script   = doc.createElement("script");
                
                // add event listener to execute when script loaded
                // - will dequeue the next node
                nodeAddEventListeners(adsidebar, script);
                
                script.src   = nodeInfo.url;
                
                // create div to hold script
                let div   = doc.createElement("div");

                // track the current div.  It will be used a script calls document.write to create new elements.
                adsidebar.currentScriptDiv = div;
                 
                // insert new script node into div
                div.appendChild(script);

                // insert new div node into ad container div
                Ads.insertNewNode(adsidebar.ads, div);
            }
            
        },
        
    };
    
  return exports;
})();
    
