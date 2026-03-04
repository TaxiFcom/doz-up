/**
 * DOZ Performance Collector - Core Web Vitals + Resource Timing
 * Lightweight (<2KB minified), zero dependencies.
 * Shares session_id with doz-analytics.js via sessionStorage.
 */
(function(){
  'use strict';
  var API = (location.protocol==='https:'?'https://':'http://') + 'api.doz.com.im';
  var sid = sessionStorage.getItem('doz_sid') || ('p_'+Math.random().toString(36).substr(2,12));
  var slug = location.pathname.replace(/\/+$/,'') || '/';
  var data = {session_id:sid, page_slug:slug, page_url:location.href};
  var sent = false;
  var errors = [];
  var errCap = 10;

  // Device info
  var w = screen.width||0;
  data.device_type = w<768?'mobile':(w<1024?'tablet':'desktop');
  data.browser = navigator.userAgent.replace(/^.*?(Chrome|Firefox|Safari|Edge|Opera)[\/\s]([\d.]+).*$/,'$1 $2').substr(0,100);
  var conn = navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  data.connection_type = conn?conn.effectiveType:null;

  // CLS tracking (session window algorithm)
  var clsValue = 0, clsEntries = [], sessionValue = 0, sessionEntries = [];
  function onCLS(entry){
    if(!entry.hadRecentInput){
      var first = sessionEntries[0], last = sessionEntries[sessionEntries.length-1];
      if(sessionValue && entry.startTime - last.startTime < 1000 && entry.startTime - first.startTime < 5000){
        sessionValue += entry.value;
        sessionEntries.push(entry);
      } else {
        sessionValue = entry.value;
        sessionEntries = [entry];
      }
      if(sessionValue > clsValue){ clsValue = sessionValue; }
    }
  }

  // LCP
  var lcpValue = null;
  function onLCP(list){
    var entries = list.getEntries();
    if(entries.length){ lcpValue = entries[entries.length-1].startTime; }
  }

  // FCP
  var fcpValue = null;
  function onFCP(list){
    var entries = list.getEntries();
    for(var i=0;i<entries.length;i++){
      if(entries[i].name==='first-contentful-paint'){ fcpValue = entries[i].startTime; }
    }
  }

  // INP (p98 of event timing)
  var inpEntries = [];
  function onINP(list){
    var entries = list.getEntries();
    for(var i=0;i<entries.length;i++){
      if(entries[i].interactionId){
        inpEntries.push(entries[i].duration);
      }
    }
  }
  function computeINP(){
    if(!inpEntries.length) return null;
    inpEntries.sort(function(a,b){return a-b;});
    var idx = Math.min(Math.ceil(inpEntries.length*0.98)-1, inpEntries.length-1);
    return inpEntries[idx];
  }

  // Start observers
  try{
    if(typeof PerformanceObserver!=='undefined'){
      new PerformanceObserver(function(l){l.getEntries().forEach(onCLS);}).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(onLCP).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(onFCP).observe({type:'paint',buffered:true});
      try{new PerformanceObserver(onINP).observe({type:'event',durationThreshold:16,buffered:true});}catch(e){}
    }
  }catch(e){}

  // Resource timing
  function getResourceData(){
    if(!performance.getEntriesByType) return {};
    var resources = performance.getEntriesByType('resource');
    var byType = {}, slow = [];
    for(var i=0;i<resources.length;i++){
      var r = resources[i];
      var ext = (r.name.split('?')[0].split('.').pop()||'other').toLowerCase();
      var type = {js:'js',css:'css',jpg:'img',jpeg:'img',png:'img',gif:'img',webp:'img',svg:'img',woff:'font',woff2:'font',ttf:'font',otf:'font'}[ext]||'other';
      if(!byType[type]) byType[type]={count:0,size:0,duration:0};
      byType[type].count++;
      byType[type].size += (r.transferSize||0);
      byType[type].duration += (r.duration||0);
      slow.push({name:r.name.split('?')[0].substr(-80),size:r.transferSize||0,duration:Math.round(r.duration)});
    }
    slow.sort(function(a,b){return b.duration-a.duration;});
    var totalSize = 0, totalCount = resources.length;
    for(var t in byType){ totalSize += byType[t].size; }
    return {resource_timing:byType, slow_resources:slow.slice(0,5), total_transfer_bytes:totalSize, resource_count:totalCount};
  }

  // TTFB
  function getTTFB(){
    var nav = performance.getEntriesByType?performance.getEntriesByType('navigation'):null;
    if(nav&&nav.length) return nav[0].responseStart;
    if(performance.timing) return performance.timing.responseStart - performance.timing.navigationStart;
    return null;
  }

  // Send beacon
  function send(){
    if(sent) return;
    sent = true;
    data.lcp_ms = lcpValue?Math.round(lcpValue):null;
    data.inp_ms = computeINP()?Math.round(computeINP()):null;
    data.cls_score = clsValue?parseFloat(clsValue.toFixed(4)):null;
    data.fcp_ms = fcpValue?Math.round(fcpValue):null;
    data.ttfb_ms = getTTFB()?Math.round(getTTFB()):null;
    var res = getResourceData();
    data.total_transfer_bytes = res.total_transfer_bytes||null;
    data.resource_count = res.resource_count||null;
    data.resource_timing = res.resource_timing||null;
    data.slow_resources = res.slow_resources||null;
    try{
      var blob = new Blob([JSON.stringify(data)],{type:'application/json'});
      navigator.sendBeacon(API+'/api/performance/beacon', blob);
    }catch(e){
      var x=new XMLHttpRequest();x.open('POST',API+'/api/performance/beacon',true);
      x.setRequestHeader('Content-Type','application/json');x.send(JSON.stringify(data));
    }
  }

  // Send after load+5s or on visibilitychange
  if(document.readyState==='complete'){
    setTimeout(send,5000);
  } else {
    window.addEventListener('load',function(){setTimeout(send,5000);});
  }
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')send();});

  // JS Error tracking
  var errorTimer = null;
  function flushErrors(){
    if(!errors.length) return;
    var batch = errors.splice(0,errCap);
    for(var i=0;i<batch.length;i++){
      try{
        var blob = new Blob([JSON.stringify(batch[i])],{type:'application/json'});
        navigator.sendBeacon(API+'/api/performance/js-error', blob);
      }catch(e){}
    }
  }
  function trackError(msg, source, stack, type){
    if(errors.length>=errCap) return;
    errors.push({
      session_id:sid, page_slug:slug,
      error_message:String(msg).substr(0,2000),
      error_source:source?String(source).substr(0,500):null,
      error_stack:stack?String(stack).substr(0,5000):null,
      error_type:type||null,
      browser:data.browser
    });
    clearTimeout(errorTimer);
    errorTimer = setTimeout(flushErrors,5000);
  }
  window.addEventListener('error',function(e){
    trackError(e.message, e.filename+':'+e.lineno+':'+e.colno, e.error?e.error.stack:null, e.error?e.error.name:null);
  });
  window.addEventListener('unhandledrejection',function(e){
    trackError('Unhandled Promise: '+(e.reason?e.reason.message||e.reason:'unknown'), null, e.reason?e.reason.stack:null, 'UnhandledRejection');
  });
})();
