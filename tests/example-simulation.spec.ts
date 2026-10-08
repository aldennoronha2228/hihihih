import {expect,test} from '@playwright/test'
for(const id of ['blink-led','uno-oled-4pin-i2c'])test(`original example ${id} compiles and simulates in the shared runtime`,async({page,request})=>{
 test.setTimeout(180000)
 await expect.poll(async()=>{try{return(await request.get('/api/health')).status()}catch{return 0}},{timeout:60000}).toBe(200)
 const response=await request.post(`/api/hardware/samples/${id}/open`)
 expect(response.ok(),await response.text()).toBe(true)
 const project=await response.json()
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 if(id==='uno-oled-4pin-i2c') {
  await expect(page.getByLabel('Serial output',{exact:true})).toContainText('OLED ready',{timeout:15000})
  await expect.poll(()=>page.locator('velxio-ssd1306-i2c-4pin').evaluate(e=>{const image=(e as HTMLElement &{imageData?:ImageData}).imageData;return !!image&&Array.from(image.data).some((v,i)=>i%4!==3&&v>0)}),{timeout:15000}).toBe(true)
 }
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:30000})
})
