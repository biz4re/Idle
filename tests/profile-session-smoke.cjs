const { app, BaseWindow, WebContentsView, session } = require('electron')
const http = require('node:http')
const assert = require('node:assert/strict')
const path = require('node:path')
const dataDir = process.env.IDLE_TEST_USER_DATA
if (!dataDir || !path.isAbsolute(dataDir)) throw new Error('An isolated test user-data directory is required')
app.setPath('userData', dataDir)
app.enableSandbox()
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Idle Profile Test</title>') })
  await new Promise((resolve) => server.listen(Number(process.env.IDLE_TEST_PORT || 37919), '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const window = new BaseWindow({ show: false })
  const make = (partition) => { const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false } }); window.contentView.addChildView(view); return view }
  const personal = make('persist:idle-profile-default'); const work = make('persist:idle-profile-work')
  await Promise.all([personal.webContents.loadURL(url), work.webContents.loadURL(url)])
  const a = session.fromPartition('persist:idle-profile-default'); const b = session.fromPartition('persist:idle-profile-work')
  if (process.env.IDLE_TEST_RESTART === '1') {
    assert.equal((await a.cookies.get({ url, name: 'idle-test' }))[0]?.value, 'personal')
    assert.equal(await personal.webContents.executeJavaScript("localStorage.getItem('idle-test')"), 'personal')
  }
  const cookie = { url, name: 'idle-test', value: 'personal', expirationDate: Math.floor(Date.now() / 1000) + 3600 }
  await a.cookies.set(cookie)
  await personal.webContents.executeJavaScript("localStorage.setItem('idle-test', 'personal')")
  assert.equal((await b.cookies.get({ url, name: 'idle-test' })).length, 0)
  assert.equal(await work.webContents.executeJavaScript("localStorage.getItem('idle-test')"), null)
  await a.cookies.flushStore(); a.flushStorageData(); b.flushStorageData()
  personal.webContents.close(); work.webContents.close(); window.close(); server.close()
  console.log('Electron Profile cookie and localStorage isolation passed.')
  app.quit()
}).catch((error) => { console.error(error.message); app.exit(1) })
