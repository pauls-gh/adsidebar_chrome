/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

var backgroundPage = ext.backgroundPage.getWindow();
var require = backgroundPage.require;

var Filter = require("filterClasses").Filter;
var FilterStorage = require("filterStorage").FilterStorage;
var Prefs = require("prefs").Prefs;
var checkWhitelisted = require("whitelisting").checkWhitelisted;
var getDecodedHostname = require("url").getDecodedHostname;

var page = null;

var sidebarEnabled = false;
var sidebarDisplayed = false;

function onLoad()
{
  ext.pages.query({active: true, lastFocusedWindow: true}, function(pages)
  {
    page = pages[0];

    // Mark page as 'local' or 'nohtml' to hide non-relevant elements
    if (!page || (page.url.protocol != "http:" &&
                  page.url.protocol != "https:"))
      document.body.classList.add("local");
    else if (!backgroundPage.htmlPages.has(page))
      document.body.classList.add("nohtml");

    // Ask content script whether clickhide is active. If so, show cancel button.
    // If that isn't the case, ask background.html whether it has cached filters. If so,
    // ask the user whether she wants those filters.
    // Otherwise, we are in default state.
    if (page)
    {
      if (checkWhitelisted(page))
        document.body.classList.add("disabled");

      page.sendMessage({type: "blockelement-get-state"}, function(response)
      {
        if (response && response.active)
          document.body.classList.add("clickhide-active");
      });
      
      // adsidebar
      if (page) {
        
        page.sendMessage({type: "adsidebar-data-request"}, function (response) {
          sidebarEnabled = response.sidebarEnabled;
          sidebarDisplayed = response.sidebarDisplayed;
            
          if (sidebarEnabled) {
              document.getElementById("adsidebar-open-close").classList.toggle("adsidebar-enabled");
              
              if (sidebarDisplayed) {
                document.getElementById("adsidebar-open-close").classList.toggle("adsidebar-displayed");
              }
          }
        });
      }
      
    }
  });

  
  // Attach event listeners
  ext.onMessage.addListener(onMessage);
  document.getElementById("enabled").addEventListener("click", toggleEnabled, false);
  document.getElementById("clickhide").addEventListener("click", activateClickHide, false);
  document.getElementById("clickhide-cancel").addEventListener("click", cancelClickHide, false);
  document.getElementById("options").addEventListener("click", function()
  {
    ext.showOptions();
  }, false);

  // Set up collapsing of menu items
  var collapsers = document.getElementsByClassName("collapse");
  for (var i = 0; i < collapsers.length; i++)
  {
    var collapser = collapsers[i];
    collapser.addEventListener("click", toggleCollapse, false);
    if (!Prefs[collapser.dataset.option])
      document.getElementById(collapser.dataset.collapsable).classList.add("collapsed");
  }
  
  // adsidebar
  document.getElementById("adsidebar-open-close").addEventListener("click", toggleAdsidebarOpen, false);

  document.getElementById("adsidebar-autohide-seconds").value = Prefs["adsidebar_autohide"];  
  document.getElementById("adsidebar-autohide-seconds").addEventListener("change", adsidebarChangeAutohideTime, false);

  document.getElementById("adsidebar-adscaling").addEventListener("click", toggleAdsidebarAdscaling, false);
  if (!Prefs.adsidebar_adScaling) {
    document.getElementById("adsidebar-adscaling").classList.add("adscaling-disabled");  
  }
    
}

function onUnload()
{
  ext.onMessage.removeListener(onMessage);
}

function onMessage(message, sender, callback)
{
  if (message.type == "report-html-page" && sender.page.id == page.id)
    document.body.classList.remove("nohtml");
}


function toggleEnabled()
{
  var disabled = document.body.classList.toggle("disabled");
  if (disabled)
  {
    var host = getDecodedHostname(page.url).replace(/^www\./, "");
    var filter = Filter.fromText("@@||" + host + "^$document");
    if (filter.subscriptions.length && filter.disabled)
      filter.disabled = false;
    else
    {
      filter.disabled = false;
      FilterStorage.addFilter(filter);
    }
  }
  else
  {
    // Remove any exception rules applying to this URL
    var filter = checkWhitelisted(page);
    while (filter)
    {
      FilterStorage.removeFilter(filter);
      if (filter.subscriptions.length)
        filter.disabled = true;
      filter = checkWhitelisted(page);
    }
  }
}

function activateClickHide()
{
  document.body.classList.add("clickhide-active");
  page.sendMessage({type: "blockelement-start-picking-element"});

  // Close the popup after a few seconds, so user doesn't have to
  activateClickHide.timeout = window.setTimeout(ext.closePopup, 5000);
}

function cancelClickHide()
{
  if (activateClickHide.timeout)
  {
    window.clearTimeout(activateClickHide.timeout);
    activateClickHide.timeout = null;
  }
  document.body.classList.remove("clickhide-active");
  page.sendMessage({type: "blockelement-finished"});
}

function toggleCollapse(event)
{
  var collapser = event.currentTarget;
  Prefs[collapser.dataset.option] = !Prefs[collapser.dataset.option];
  collapser.parentNode.classList.toggle("collapsed");
}

function toggleAdsidebarOpen()
{
  page.sendMessage({type: "adsidebar-toggle-sidebar"});
  window.close();
}

function adsidebarChangeAutohideTime()
{
  
  var newValue =  document.getElementById("adsidebar-autohide-seconds").value;
  Prefs.adsidebar_autohide = parseInt(newValue);
  
  page.sendMessage({type: "adsidebar-update-child-prefs",
                    enabled : Prefs["enabled"],
                    adsidebar_autohide :  Prefs["adsidebar_autohide"],
                    adsidebar_adScaling :  Prefs["adsidebar_adScaling"]});
}


function toggleAdsidebarAdscaling()
{
  
  var newValue =  document.getElementById("adsidebar-autohide-seconds").value;
  Prefs.adsidebar_adScaling = !Prefs.adsidebar_adScaling;
  
  page.sendMessage({type: "adsidebar-update-child-prefs",
                    enabled : Prefs["enabled"],
                    adsidebar_autohide :  Prefs["adsidebar_autohide"],
                    adsidebar_adScaling :  Prefs["adsidebar_adScaling"]});
  
    if (!Prefs.adsidebar_adScaling) {
      document.getElementById("adsidebar-adscaling").classList.add("adscaling-disabled");  
    } else {
      document.getElementById("adsidebar-adscaling").classList.remove("adscaling-disabled");  
    }
}


document.addEventListener("DOMContentLoaded", onLoad, false);
window.addEventListener("unload", onUnload, false);
