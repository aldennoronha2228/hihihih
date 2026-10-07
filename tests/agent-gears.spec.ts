import {expect,test} from '@playwright/test'
for(const width of [1440,390])test(`small gears appear only while generating at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:800})
 await page.route('**/api/health',route=>route.fulfill({json:{configured:true,model:'test'}}))
 let finish!:()=>void
 const waiting=new Promise<void>(resolve=>{finish=resolve})
 await page.route('**/api/chat',async route=>{await waiting;await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'text',channel:'answer',text:'Done.'})+'\n'+JSON.stringify({type:'done'})+'\n'})})
 await page.goto('/assistant')
 await page.getByRole('textbox',{name:'Message WireUp'}).fill('Hello')
 await page.getByRole('button',{name:'Send message',exact:true}).click()
 const gears=page.locator('.wireup-agent-gears')
 await expect(gears).toBeVisible()
 expect((await gears.boundingBox())!.width).toBeLessThanOrEqual(32)
 expect(await gears.locator('svg').count()).toBe(3)
 await page.emulateMedia({reducedMotion:'reduce'})
 expect(await gears.locator('svg').first().evaluate(element=>getComputedStyle(element).animationName)).toBe('none')
 finish()
 await expect(gears).toHaveCount(0)
})
