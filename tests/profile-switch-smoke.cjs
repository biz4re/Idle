// Run after the production build with Electron. Set IDLE_PROFILE_SMOKE_RESULT to retain the result; set IDLE_PROFILE_SMOKE_RESTORE to that result for the restart phase.
const { app, BrowserWindow, ipcMain, webContents, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const expected = process.env.IDLE_PROFILE_SMOKE_RESTORE ? JSON.parse(fs.readFileSync(process.env.IDLE_PROFILE_SMOKE_RESTORE, 'utf8')) : null;
const smokeDirectory = expected ? path.dirname(expected.dataDirectory) : fs.mkdtempSync(path.join(os.tmpdir(), 'idle-profile-smoke-'));
const resultPath = process.env.IDLE_PROFILE_SMOKE_RESULT || path.join(smokeDirectory, expected ? 'restore-result.json' : 'result.json');
app.setPath('userData', expected ? expected.dataDirectory : path.join(smokeDirectory, 'data')); 
const pause = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label) { for (let i=0; i<120; i++) { const v = await fn(); if (v) return v; await pause(100); } throw Error('Timeout: ' + label); }
function assert(ok, message) { if (!ok) throw Error(message); }
app.on('browser-window-created', (_event, window) => {
  if (window.__smoke) return;
  window.__smoke = true;
  window.webContents.once('did-finish-load', async () => {
    const report = {};
    let server;
    try {
      const ui = window.webContents; const wid = window.id; const rid = ui.id;
      let reloads = 0; ui.on('did-start-navigation', (_e,_u,_inPlace,main) => { if (main) reloads++; });
      await ui.executeJavaScript(`window.__profileSmoke = null; window.idle.onTabState(s => window.__profileSmoke = s); window.idle.tabCommand({type:'sync'});`);
      const state = () => ui.executeJavaScript('window.__profileSmoke');
      const cmd = c => ui.executeJavaScript(`window.idle.tabCommand(${JSON.stringify(c)})`);
      const first = await waitFor(async () => { const s = await state(); return s && s.profiles.length >= 2 && s; }, 'initial profiles');
      if (expected) {
        assert(first.peekMode==='manual' && first.activeProfileId===expected.profileA && first.activeWorkspaceId===expected.workspace && first.splitTree?.type==='split', 'Profile, Workspace, or Split View not restored after restart');
        assert(first.tabs.some(t=>t.id===expected.firstTab) && first.tabs.some(t=>t.id===expected.secondTab), 'tabs not restored after restart');
        const restoredPage = await waitFor(() => webContents.getAllWebContents().find(w=>w.getURL()===expected.url), 'restored page');
        await waitFor(() => !restoredPage.isLoading(), 'restored page load');
        assert((await restoredPage.executeJavaScript("localStorage.getItem('profile-smoke')"))==='A', 'A localStorage not restored');
        assert((await restoredPage.session.cookies.get({url:expected.url,name:'profile-smoke'}))[0]?.value==='A', 'A cookie not restored');
        await cmd({type:'profile-switch',id:expected.profileB}); await waitFor(async () => (await state()).activeProfileId===expected.profileB, 'restore B');
        const bPage = await waitFor(() => webContents.getAllWebContents().find(w=>w.id!==restoredPage.id && w.getURL()===expected.url), 'restored B page');
        await waitFor(() => !bPage.isLoading(), 'restored B load');
        assert((await bPage.executeJavaScript("localStorage.getItem('profile-smoke')"))==='B', 'B localStorage not restored');
        assert((await bPage.session.cookies.get({url:expected.url,name:'profile-smoke'}))[0]?.value==='B', 'B cookie not restored');
        Object.assign(report,{pass:true,restartRestored:true,profileIsolation:true,workspaceRestored:true,splitRestored:true});
      } else {
      const a = first.activeProfileId, b = first.profiles.find(p => p.id !== a).id;
      server = http.createServer((req,res) => { const send = () => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html><title>Profile smoke</title><body>Profile test</body></html>'); }; if (req.url === '/slow') setTimeout(send, 800); else send(); });
      await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
      const url = `http://127.0.0.1:${server.address().port}/`;
      const page = async () => waitFor(() => webContents.getAllWebContents().find(w => w.getURL() === url), 'page view');
      await cmd({type:'navigate',value:url});
      await waitFor(async () => { const s=await state(); return s.activeProfileId===a && s.tabs.some(t=>t.url===url && !t.loading); },'first page');
      const aPage = await page(); const aPageId = aPage.id; const aSession = aPage.session; let aNavigations = 0; aPage.on('did-start-navigation', (_e, _url, _inPlace, main) => { if (main) aNavigations++ });
      const originalWorkspace = (await state()).activeWorkspaceId; const originalTab = (await state()).activeId;
      await cmd({type:'workspace-create',name:'Smoke workspace',emoji:'🌱'});
      const otherWorkspace = await waitFor(async () => { const s=await state(); return s.activeWorkspaceId!==originalWorkspace && s.activeWorkspaceId },'new workspace');
      await cmd({type:'navigate',value:url+'slow'}); await waitFor(async () => (await state()).tabs.some(t=>t.loading),'pending navigation');
      await cmd({type:'profile-switch',id:b}); await waitFor(async () => (await state()).activeProfileId===b,'switch during navigation');
      await pause(1200); await cmd({type:'profile-switch',id:a}); await waitFor(async () => (await state()).activeProfileId===a,'return after navigation');
      assert((await state()).tabs.some(t=>t.url===url+'slow' && !t.loading),'inactive Profile navigation was lost');
      await cmd({type:'workspace-switch',id:originalWorkspace}); await waitFor(async () => (await state()).activeWorkspaceId===originalWorkspace,'restore workspace');
      await cmd({type:'create'}); const secondTab = await waitFor(async () => {const s=await state(); return s.tabs.length>=2 && s.activeId!==originalTab && s.activeId},'second tab');
      await ui.executeJavaScript('window.idle.setViewBounds({x:250,y:50,width:800,height:600})');
      await cmd({type:'split-drag-start',token:'smoke'}); await cmd({type:'split-drop',id:originalTab,targetId:secondTab,workspaceId:originalWorkspace,edge:'left'}); await cmd({type:'split-drag-end',token:'smoke'});
      await waitFor(async () => (await state()).splitTree?.type==='split','split view');
      await cmd({type:'split-drag-start',token:'settings-smoke'}); await cmd({type:'split-drag-ready',token:'settings-smoke'});
      await cmd({type:'settings-menu',x:0,y:0});
      await waitFor(() => ui.executeJavaScript('!!document.querySelector(".settings-page")'), 'open Settings');
      if (process.env.IDLE_SETTINGS_SCREENSHOT) fs.writeFileSync(process.env.IDLE_SETTINGS_SCREENSHOT, (await ui.capturePage()).toPNG());
      assert(!window.contentView.children.some(v => v.webContents?.id===aPageId), 'webpage still attached over Settings');
      await ui.executeJavaScript(`Array.from(document.querySelectorAll('.settings-nav-item')).find(b => b.textContent.includes('Tabs & Spaces')).click()`);
      await waitFor(() => ui.executeJavaScript('!!document.querySelector("input[name=peek-mode]")'), 'Peek settings');
      await ui.executeJavaScript(`document.querySelectorAll('input[name=peek-mode]')[1].click()`);
      await waitFor(async () => (await state()).peekMode==='manual','save Peek preference');
      await cmd({type:'profile-switch',id:b}); await waitFor(async ()=>(await state()).activeProfileId===b,'switch Profile in Settings');
      assert(await ui.executeJavaScript('!!document.querySelector(".settings-page")'), 'Settings closed during Profile switch');
      assert((await state()).peekMode==='automatic','Peek preference leaked into another Profile');
      await cmd({type:'profile-switch',id:a}); await waitFor(async ()=>(await state()).activeProfileId===a,'return Profile in Settings');
      assert((await state()).peekMode==='manual','Peek preference not restored');
      assert(!window.contentView.children.some(v => v.webContents?.id===aPageId), 'webpage attached while Settings open');
      await ui.executeJavaScript(`document.querySelector('[aria-label="Close Settings"]').click()`);
      await waitFor(() => !ui.isDestroyed() && window.contentView.children.some(v => v.webContents?.id===aPageId && v.getVisible()), 'restore webpage views after split drag');
      ui.sendInputEvent({type:'keyDown',keyCode:',',modifiers: process.platform==='darwin' ? ['meta'] : ['control']});
      ui.sendInputEvent({type:'keyUp',keyCode:',',modifiers: process.platform==='darwin' ? ['meta'] : ['control']});
      await waitFor(() => ui.executeJavaScript('!!document.querySelector(".settings-page")'), 'open Settings with shortcut');
      assert(await ui.executeJavaScript(`document.querySelector('#settings-heading')?.textContent==='Tabs & Spaces'`), 'Settings category was not retained');
      await cmd({type:'activate',id:originalTab});
      await waitFor(() => ui.executeJavaScript('!document.querySelector(".settings-page")'), 'return to tab from Settings');
      await waitFor(() => window.contentView.children.some(v => v.webContents?.id===aPageId), 'restore after shortcut');
      await cmd({type:'peek-open',id:originalTab,url});
      const peek = await waitFor(() => webContents.getAllWebContents().find(w=>w.getURL().includes('#peek-toolbar')),'Peek toolbar');
      await aPage.executeJavaScript("localStorage.setItem('profile-smoke','A')");
      await aPage.session.cookies.set({url,name:'profile-smoke',value:'A',expirationDate:Date.now()/1000+3600});
      const listenersBefore = [ipcMain.listenerCount('idle:tab-command'),ipcMain.listenerCount('idle:view-bounds'),ipcMain.listenerCount('idle:peek-link')];
      await cmd({type:'profile-switch',id:b});
      await waitFor(async () => (await state()).activeProfileId===b,'switch to B');
      await waitFor(() => peek.isDestroyed(),'Peek closes on switch');
      await cmd({type:'navigate',value:url});
      await waitFor(async () => {const s=await state(); return s.activeProfileId===b && s.tabs.some(t=>t.url===url && !t.loading)},'second page');
      const bPage = await waitFor(() => webContents.getAllWebContents().find(w=>w.id!==aPageId && w.getURL()===url),'second view'); const bSession = bPage.session;
      assert((await bPage.executeJavaScript("localStorage.getItem('profile-smoke')"))===null,'localStorage leaked into B');
      assert(!(await bPage.session.cookies.get({url,name:'profile-smoke'})).length,'cookie leaked into B');
      await bPage.executeJavaScript("localStorage.setItem('profile-smoke','B')"); await bPage.session.cookies.set({url,name:'profile-smoke',value:'B',expirationDate:Date.now()/1000+3600});
      const contentsBefore = webContents.getAllWebContents().length; const shortcutListenersBefore = ui.listenerCount('before-input-event');
      for (let i=0;i<10;i++) { const target=i%2===0?a:b; await cmd({type:'profile-switch',id:target}); await waitFor(async ()=>(await state()).activeProfileId===target,'rapid switch '+i); }
      await cmd({type:'profile-switch',id:a}); await waitFor(async ()=>(await state()).activeProfileId===a,'return to A');
      const restored = await state(); assert(restored.activeWorkspaceId === originalWorkspace && restored.splitTree?.type === 'split' && restored.tabs.some(t=>t.id===originalTab) && restored.tabs.some(t=>t.id===secondTab),'Workspace, tabs, or split view not restored');
      await cmd({type:'workspace-switch',id:otherWorkspace}); await waitFor(async ()=>(await state()).activeWorkspaceId===otherWorkspace,'switch to alternate workspace');
      await cmd({type:'profile-switch',id:b}); await waitFor(async ()=>(await state()).activeProfileId===b,'leave alternate workspace');
      await cmd({type:'profile-switch',id:a}); await waitFor(async ()=>(await state()).activeProfileId===a,'return to alternate workspace');
      assert((await state()).activeWorkspaceId===otherWorkspace,'active Workspace not restored');
      await cmd({type:'workspace-switch',id:originalWorkspace}); await waitFor(async ()=>(await state()).activeWorkspaceId===originalWorkspace,'return to split workspace');
      assert((await state()).splitTree?.type==='split','split view lost after Workspace switch');
      assert(BrowserWindow.getAllWindows().includes(window) && window.id===wid && ui.id===rid && reloads===0,'window or renderer changed');
      assert(!aPage.isDestroyed() && aPage.id===aPageId && aPage.getURL()===url && aNavigations===0,'A page was reloaded or destroyed');
      assert(webContents.getAllWebContents().length===contentsBefore,'WebContents count grew during switching');
      assert(ui.listenerCount('before-input-event')===shortcutListenersBefore,'Window shortcut listeners accumulated');
      assert((await aPage.executeJavaScript("localStorage.getItem('profile-smoke')"))==='A','A localStorage changed');
      assert((await aPage.session.cookies.get({url,name:'profile-smoke'}))[0]?.value==='A','A cookie changed');
      const listenersAfter = [ipcMain.listenerCount('idle:tab-command'),ipcMain.listenerCount('idle:view-bounds'),ipcMain.listenerCount('idle:peek-link')];
      assert(JSON.stringify(listenersBefore)===JSON.stringify(listenersAfter),'IPC listeners accumulated');
      await cmd({type:'profile-create',name:'Third'});
      await waitFor(async () => { const s=await state(); return s.profiles.length===3 && s.activeProfileId!==a && s.activeProfileId!==b }, 'third Profile');
      await waitFor(() => bPage.isDestroyed(), 'inactive Profile eviction');
      await cmd({type:'profile-switch',id:b}); await waitFor(async () => (await state()).activeProfileId===b, 'restore evicted Profile');
      const restoredB = await waitFor(() => webContents.getAllWebContents().find(w=>w.getURL()===url && w.session===bSession), 'restored evicted page');
      await waitFor(() => !restoredB.isLoading(), 'restored evicted page load');
      assert((await restoredB.executeJavaScript("localStorage.getItem('profile-smoke')"))==='B', 'evicted Profile storage not restored');
      await cmd({type:'profile-switch',id:a}); await waitFor(async () => (await state()).activeProfileId===a, 'restore first Profile after eviction');
      assert((await state()).splitTree?.type==='split','split view not restored after eviction');
      await aSession.cookies.flushStore(); await bSession.cookies.flushStore(); await aSession.flushStorageData(); await bSession.flushStorageData();
      Object.assign(report,{pass:true,profileA:a,profileB:b,url,workspace:originalWorkspace,firstTab:originalTab,secondTab,windowId:wid,rendererId:rid,pageId:aPageId,rendererReloads:reloads,rapidSwitches:11,listenersBefore,listenersAfter,partitionIsolation:true,pageReused:true,splitRestored:true,settingsViewsRestored:true,settingsShortcut:true,settingsPerProfile:true,peekClosed:true,workspaceRestored:true,pendingNavigationPreserved:true,evictionRestored:true,viewCount:contentsBefore,windowShortcutListeners:shortcutListenersBefore,dataDirectory:app.getPath('userData')});
      }
    } catch (error) { report.pass=false; report.error=error.stack || String(error); }
    fs.writeFileSync(resultPath,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)); if(server) server.close(); if (!report.pass) process.exitCode = 1; app.quit();
  });
});
if (expected) {
  const restoreServer = http.createServer((_req,res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<html><title>Profile smoke</title><body>Profile test</body></html>'); });
  restoreServer.listen(Number(new URL(expected.url).port), '127.0.0.1', () => require(path.join(process.cwd(),'out/main/index.js')));
  app.on('will-quit', () => restoreServer.close());
} else require(path.join(process.cwd(),'out/main/index.js'));

