import { expect,test } from '@playwright/test'
for(const board of ['esp32-devkit-v1','raspberry-pi-4']) {
 test(`${board} supports circuit and source without simulation`,async({page,request})=>{
  const project=await(await request.post('/api/hardware/projects',{data:{name:'Non-simulated build',board}})).json()
  for(const args of [{type:'led',id:'led',x:400,y:180},{type:'resistor',id:'resistor',x:480,y:240}])expect((await request.post(`/api/hardware/project/${project.id}/command`,{data:{name:'add_component',args}})).ok()).toBe(true)
  const source=board.startsWith('raspberry')?'from gpiozero import LED\nfrom time import sleep\nled = LED(17)\nwhile True:\n    led.toggle()\n    sleep(1)\n':'void setup(){pinMode(2,OUTPUT);}\nvoid loop(){digitalWrite(2,HIGH);delay(1000);digitalWrite(2,LOW);delay(1000);}'
  expect((await request.post(`/api/hardware/project/${project.id}/command`,{data:{name:'generate_firmware',args:{source}}})).ok()).toBe(true)
  await page.goto(`/project/${project.id}`)
  await expect(page.getByText(/Simulation is currently unavailable for/)).toBeVisible()
  await expect(page.getByRole('button',{name:'Run',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Sketch',exact:true}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const stored=await(await request.get(`/api/hardware/projects/${project.id}`)).json()
  expect(stored.firmware.source).toBe(source)
  if(board.startsWith('raspberry'))expect(stored.firmware.filename).toBe('main.py')
 })
}
