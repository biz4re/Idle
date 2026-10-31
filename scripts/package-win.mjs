import { cp, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows')
const require = createRequire(import.meta.url)
const root = process.cwd()
const output = join(root, 'release', `idle-win32-${Date.now()}`)
const app = join(output, 'resources', 'app')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await cp(dirname(require('electron')), output, { recursive: true, errorOnExist: true })
await rename(join(output, 'electron.exe'), join(output, 'Idle.exe'))
await mkdir(join(app, 'node_modules'), { recursive: true })
await Promise.all(['out', 'resources'].map((name) => cp(join(root, name), join(app, name), { recursive: true })))
await cp(join(root, 'LICENSE'), join(app, 'LICENSE'))
await writeFile(join(app, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }))
const tldts = await realpath(join(root, 'node_modules', 'tldts'))
const coreEntry = createRequire(join(tldts, 'package.json')).resolve('tldts-core')
const coreRoot = coreEntry.slice(0, coreEntry.lastIndexOf('dist') - 1)
await cp(tldts, join(app, 'node_modules', 'tldts'), { recursive: true })
await cp(coreRoot, join(app, 'node_modules', 'tldts-core'), { recursive: true })
console.log(`Windows package: ${output}`)
