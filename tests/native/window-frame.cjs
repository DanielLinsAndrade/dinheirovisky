const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
module.exports = async ({ page, invoke, output, pid }) => {
  const evidence = {};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  const screenshot=async name=>{
    const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(output,name),Buffer.from(shot.data,'base64'));
  };
  const native = action => promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'window-frame.ps1'),'-TargetPid',String(pid),'-Action',action], {windowsHide:true});
  const state = (name) => invoke(`plugin:window|${name}`, {label:'main'});
  const waitState = async (name, expected) => {
    for (let n=0;n<100;n++) { if(await state(name)===expected)return; await new Promise(r=>setTimeout(r,50)); }
    assert.equal(await state(name), expected, name);
  };
  assert.equal(await state('is_decorated'),false);
  assert.equal(await state('is_resizable'),true);
  evidence.dragRegion=await page.evaluate(()=>({
    count:document.querySelectorAll('[data-tauri-drag-region]').length,
    controlsOutside:Array.from(document.querySelectorAll('.window-controls button')).every(el=>!el.closest('[data-tauri-drag-region]')),
    contentOutside:!document.querySelector('main').closest('[data-tauri-drag-region]'),
  }));
  assert.equal(evidence.dragRegion.count,1);
  assert.equal(evidence.dragRegion.controlsOutside,true);
  assert.equal(evidence.dragRegion.contentOutside,true);
  await page.getByRole('button',{name:'Maximizar janela',exact:true}).click();
  await waitState('is_maximized',true);
  await page.getByRole('button',{name:'Restaurar janela',exact:true}).waitFor();
  const nativeSize=await state('inner_size'), scale=await state('scale_factor');
  await page.waitForFunction(width=>Math.abs(innerWidth-width)<=1,nativeSize.width/scale);
  evidence.maximizedViewport=await page.evaluate(()=>({width:innerWidth,clientWidth:document.documentElement.clientWidth,height:innerHeight,barWidth:document.querySelector('.window-titlebar').getBoundingClientRect().width}));
  assert.equal(evidence.maximizedViewport.clientWidth,evidence.maximizedViewport.barWidth);
  await screenshot('window-maximized.png');
  await page.getByRole('button',{name:'Restaurar janela',exact:true}).click();
  await waitState('is_maximized',false);
  // Exercise Tauri's official data-tauri-drag-region double-click handler.
  await page.locator('.window-drag-region').dispatchEvent('mousedown',{button:0,buttons:1,detail:2});
  await waitState('is_maximized',true);
  await page.locator('.window-drag-region').dispatchEvent('mousedown',{button:0,buttons:1,detail:2});
  await waitState('is_maximized',false);
  await page.getByRole('button',{name:'Minimizar janela',exact:true}).click();
  await waitState('is_minimized',true);
  await native('restore');
  await waitState('is_minimized',false);
  await native('resize');
  evidence.size = await state('outer_size');
  assert.equal(evidence.size.width,1000);
  assert.equal(evidence.size.height,740);
  await page.getByRole('button',{name:/Ir para…/}).click();
  const dialog = page.getByRole('dialog',{name:'Busca e navegação'});
  const bar = dialog.locator('.window-titlebar');
  assert.equal(await bar.evaluate(el=>el.getBoundingClientRect().top),0);
  const close = dialog.getByRole('button',{name:'Fechar janela',exact:true});
  await close.click({trial:true});
  await dialog.getByRole('button',{name:'Maximizar janela',exact:true}).click();
  await waitState('is_maximized',true);
  await dialog.getByRole('button',{name:'Restaurar janela',exact:true}).click();
  await waitState('is_maximized',false);
  await screenshot('window-dialog.png');
  await page.keyboard.press('Escape');
  const positionBeforeScroll=await state('outer_position');
  await page.mouse.move(800,400);
  await page.mouse.wheel(200,200);
  assert.deepEqual(await state('outer_position'),positionBeforeScroll,'Diagonal scrolling must not move the native window');
  evidence.drag='Official region and double-click verified; physical drag displacement not automated';
  await screenshot('window-normal.png');
  evidence.decoration = 'disabled';
  evidence.controls = 'minimize, maximize, restore, double-click, resize, controls in modal passed';
  evidence.physicalInput = 'Physical mouse/touchpad and native drag displacement require manual confirmation; no global pointer input used.';
  fs.writeFileSync(path.join(output,'window-frame.json'),JSON.stringify(evidence,null,2));
};
