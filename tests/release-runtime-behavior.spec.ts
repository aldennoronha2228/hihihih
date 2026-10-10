import {expect,test} from '@playwright/test'
import fs from 'node:fs'
const evidence='audit-artifacts/recovered-release-projects.json'
test('selected live-built projects show actual peripheral output, not just a running flag',async({page})=>{
 test.setTimeout(150000)
 const results=JSON.parse(fs.readFileSync(evidence,'utf8'))
 for(const id of ['uno-servo','uno-lcd','uno-dht','s3-button']){
  const record=results.findLast((item:{name:string;compiler?:{status:string}})=>item.name===`Release audit ${id}` && item.compiler?.status==='simulation_ready')
  await page.goto(`/project/${record.id}`)
  await expect(page.getByText('Runtime: Connected',{exact:true})).toBeVisible({timeout:30000})
  await page.getByRole('button',{name:'Run',exact:true}).click()
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible({timeout:30000})
  if(id==='uno-servo')await expect.poll(()=>page.locator('wokwi-servo').first().evaluate(el=>(el as HTMLElement &{angle:number}).angle),{timeout:10000}).toBeGreaterThan(10)
  if(id==='uno-lcd')await expect.poll(()=>page.locator('wokwi-lcd1602').first().evaluate(el=>String.fromCharCode(...Array.from((el as HTMLElement &{characters:Uint8Array}).characters??[]))),{timeout:10000}).toContain('Hello')
  if(id==='uno-dht'){await page.getByRole('button',{name:'Serial monitor',exact:true}).click();await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/\d+[.,]\d+/, {timeout:10000})}
  await page.getByRole('button',{name:'Stop',exact:true}).click()
  await page.getByRole('tab',{name:'Schematic',exact:true}).click()
  await expect(page.getByRole('region',{name:'Schematic view',exact:true})).toBeVisible()
 }
})
