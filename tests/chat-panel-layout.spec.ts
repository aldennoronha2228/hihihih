import { expect, test } from '@playwright/test'
for (const width of [1440, 390]) {
  test(`embedded chat fills panel and compact input sends at ${width}px`, async ({page,request})=>{
    const project=await (await request.post('/api/hardware/projects',{data:{name:'Chat layout',board:'arduino-uno'}})).json()
    await page.setViewportSize({width,height:900})
    await page.route('**/api/health',route=>route.fulfill({json:{configured:true,model:'test'}}))
    await page.route('**/api/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'text',channel:'answer',text:'The compact chat message was received.'})+'\n'+JSON.stringify({type:'done'})+'\n'}))
    await page.goto(`/project/${project.id}`)
    if(width<900)await page.getByRole('button',{name:'Agent',exact:true}).click()
    const input=page.getByRole('textbox',{name:'Message WireUp'})
    await expect(input).toBeVisible()
    expect(await page.locator('.wireup-composer-compact .wireup-rotating-placeholder span').evaluate(element=>getComputedStyle(element).fontSize)).toBe('12px')
    const composer=page.locator('.wireup-composer-compact')
    const box=await composer.boundingBox()
    expect(box!.height).toBeLessThan(135)
    const panel=await page.locator('.hw-agent-panel').boundingBox()
    if(width>900){
      const header=await page.locator('.hw-header').boundingBox()
      expect(panel!.y).toBeLessThanOrEqual(header!.y+header!.height+2)
      const toolbar=await page.locator('.hw-toolbar').boundingBox()
      expect(toolbar!.x+toolbar!.width).toBeLessThanOrEqual(panel!.x+1)
    }
    const chat=await page.locator('.wireup-chat-embedded').boundingBox()
    expect(chat!.y+chat!.height).toBeGreaterThan(panel!.y+panel!.height-4)
    expect(box!.x).toBeGreaterThanOrEqual(panel!.x)
    expect(box!.x+box!.width).toBeLessThanOrEqual(panel!.x+panel!.width+1)
    await input.fill('Hello from the smaller chat input')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await expect(page.getByText('The compact chat message was received.',{exact:false})).toBeVisible({timeout:20000})
    await input.fill(Array.from({length:10},(_,i)=>`Line ${i}`).join('\n'))
    expect((await composer.boundingBox())!.height).toBeLessThan(210)
    await page.screenshot({path:`test-results/compact-chat-${width}.png`})
  })
}
