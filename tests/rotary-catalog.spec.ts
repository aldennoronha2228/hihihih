import {expect,test} from '@playwright/test'
for(const width of [1440,390])test(`rotary encoder appears only for tested boards at ${width}px`,async({page,request})=>{
 await expect.poll(async()=>{try{return(await request.get('/api/health')).status()}catch{return 0}},{timeout:60000}).toBe(200)
 await page.setViewportSize({width,height:900})
 for(const board of ['arduino-uno','arduino-mega']){
  const project=await(await request.post('/api/hardware/projects',{data:{name:'Rotary filter',board}})).json()
  await page.goto(`/project/${project.id}`)
  if(width<900)await page.getByRole('button',{name:'Parts',exact:true}).click()
  await page.getByRole('textbox',{name:'Search components',exact:true}).fill('KY-040')
  if(board==='arduino-uno')await expect(page.locator('.hw-catalog-card')).toHaveCount(1,{timeout:10000})
  else await expect(page.locator('.hw-catalog')).toContainText('No simulated components',{timeout:10000})
 }
})
