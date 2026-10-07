import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`change design opens revised setup rather than the same warning at ${width}px`, async ({page,request}) => {
    const project=await (await request.post('/api/hardware/projects',{data:{name:'Revise calculator'}})).json()
    await page.setViewportSize({width,height:900})
    await page.route('**/api/health',route=>route.fulfill({json:{configured:true,model:'test'}}))
    let calls=0
    const report={type:'feasibility',id:'revise-display',status:'blocked',issues:[{code:'display_pins',title:'Pins are not verified',message:'LCD pins are unavailable.'}],choices:[{id:'revise',label:'Change the design'},{id:'cancel',label:'Cancel'}]}
    await page.route('**/api/chat',route=>{
      calls++
      if(calls===1)return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(report)+'\n'+JSON.stringify({type:'done',status:'awaiting_approval'})+'\n'})
      expect(route.request().postDataJSON().approval.choice).toBe('revise')
      return route.fulfill({contentType:'application/x-ndjson',body:[{...report,status:'revise'},{type:'questions',summary:'Choose a supported calculator output.',questions:[{id:'output',question:'Where should results appear?',options:[{id:'serial',label:'Serial monitor'},{id:'ai_choose',label:'Let AI choose'}]}]},{type:'done',status:'awaiting_answers'}].map(event=>JSON.stringify(event)).join('\n')+'\n'})
    })
    await page.goto(`/project/${project.id}`)
    if(width<900)await page.getByRole('button',{name:'Agent',exact:true}).click()
    await page.getByRole('textbox',{name:'Message WireUp'}).fill('Build a mini calculator using Arduino Uno')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    const card=page.getByRole('form',{name:'Prototype feasibility review'})
    await card.getByRole('radio',{name:'Change the design',exact:true}).check()
    await card.getByRole('button',{name:'Confirm choice'}).click()
    await expect(page.getByRole('dialog',{name:'Set up your project'})).toBeVisible()
    await expect(page.getByRole('radio',{name:'Serial monitor',exact:true})).toBeVisible()
    await expect(card).toHaveCount(0)
  })
  test(`answering the review continues without asking again at ${width}px`, async ({page,request}) => {
    const project=await (await request.post('/api/hardware/projects',{data:{name:'Answer continuation'}})).json()
    await page.setViewportSize({width,height:900})
    await page.route('**/api/health',route=>route.fulfill({json:{configured:true,model:'test'}}))
    let calls=0
    const report={type:'feasibility',id:'answered-review',status:'awaiting_approval',issues:[{code:'servo_runtime',title:'Servo simulation unavailable',message:'Unsupported runtime.'}],choices:[{id:'hardware_only',label:'Proceed with limitations'}]}
    await page.route('**/api/chat',route=>{
      calls++
      if(calls===1)return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify(report)+'\n'+JSON.stringify({type:'done',status:'awaiting_approval'})+'\n'})
      expect(route.request().postDataJSON().approval).toEqual({assessment_id:'answered-review',choice:'hardware_only'})
      return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({...report,status:'approved'})+'\n'+JSON.stringify({type:'text',channel:'answer',text:'Continuing your approved build.'})+'\n'+JSON.stringify({type:'done',status:'success'})+'\n'})
    })
    await page.goto(`/project/${project.id}`)
    if(width<900)await page.getByRole('button',{name:'Agent',exact:true}).click()
    await page.getByRole('textbox',{name:'Message WireUp'}).fill('Build servo circuit')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    const card=page.getByRole('form',{name:'Prototype feasibility review'})
    await card.getByRole('radio',{name:'Proceed with limitations',exact:true}).check()
    await card.getByRole('button',{name:'Confirm choice'}).click()
    await expect(page.getByText('Continuing your approved build.',{exact:false})).toBeVisible({timeout:20000})
    await expect(card).toHaveCount(0)
    expect(calls).toBe(2)
  })
  test(`the same review is shown once across repeated events at ${width}px`, async ({page,request}) => {
    const project=await (await request.post('/api/hardware/projects',{data:{name:'Duplicate review'}})).json()
    await page.setViewportSize({width,height:900})
    await page.route('**/api/health',route=>route.fulfill({json:{configured:true,model:'test'}}))
    const report={type:'feasibility',id:'duplicate-review',status:'awaiting_approval',issues:[{code:'servo_runtime',title:'Servo simulation unavailable',message:'The requested simulation is unsupported.'}],choices:[{id:'hardware_only',label:'Proceed with limitations'},{id:'cancel',label:'Cancel'}]}
    await page.route('**/api/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[report,report,{type:'done',status:'awaiting_approval'}].map(event=>JSON.stringify(event)).join('\n')+'\n'}))
    await page.goto(`/project/${project.id}`)
    if(width<900)await page.getByRole('button',{name:'Agent',exact:true}).click()
    await page.getByRole('textbox',{name:'Message WireUp'}).fill('Move a servo')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await expect(page.getByRole('form',{name:'Prototype feasibility review'})).toHaveCount(1)
    await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeVisible()
    await page.getByRole('textbox',{name:'Message WireUp'}).fill('Check that same design again')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await expect(page.getByRole('form',{name:'Prototype feasibility review'})).toHaveCount(1)
  })
  test(`supported assessment does not interrupt with confirmation at ${width}px`, async ({page,request}) => {
    const project=await (await request.post('/api/hardware/projects',{data:{name:'Supported build'}})).json()
    await page.setViewportSize({width,height:900})
    await page.route('**/api/health', route => route.fulfill({json:{configured:true,model:'test'}}))
    await page.route('**/api/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'feasibility',id:'approved-report',status:'approved',summary:'All requested operations are supported.',issues:[],choices:[]})+'\n'+JSON.stringify({type:'text',channel:'answer',text:'Continuing with the supported build.'})+'\n'+JSON.stringify({type:'done'})+'\n'}))
    await page.goto(`/project/${project.id}`)
    if(width<900)await page.getByRole('button',{name:'Agent',exact:true}).click()
    await page.getByRole('textbox',{name:'Message WireUp'}).fill('Build a supported LED circuit')
    await page.getByRole('button',{name:'Send message',exact:true}).click()
    await expect(page.getByText('Continuing with the supported build.',{exact:false})).toBeVisible({timeout:20000})
    await expect(page.getByRole('form',{name:'Prototype feasibility review'})).toHaveCount(0)
  })
  test(`limitations are disclosed before placement and cancellation leaves canvas empty at ${width}px`, async ({ page, request }) => {
    const project = await (await request.post('/api/hardware/projects', { data: { name: 'Beginner feasibility test' } })).json()
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/health', route => route.fulfill({ json: { configured: true, model: 'test' } }))
    let calls = 0
    await page.route('**/api/chat', route => {
      calls++
      if (calls === 1) return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'feasibility', id: 'a'.repeat(32), status: 'blocked', summary: 'Joystick pins and servo movement are not verified here.', issues: [{ code: 'joystick_pins', title: 'Joystick cannot be wired accurately', message: 'Its pins are not verified.', reason: 'We cannot guess your connections.' }], choices: [{ id: 'revise', label: 'Change the design' }, { id: 'cancel', label: 'Cancel without changing the project' }] }) + '\n' + JSON.stringify({ type: 'done', status: 'awaiting_approval' }) + '\n' })
      expect(route.request().postDataJSON().approval).toEqual({ assessment_id: 'a'.repeat(32), choice: 'cancel' })
      return route.fulfill({ body: JSON.stringify({ type: 'text', channel: 'answer', text: 'Build cancelled. No changes were made.' }) + '\n' + JSON.stringify({ type: 'done' }) + '\n' })
    })
    await page.goto(`/project/${project.id}`, { waitUntil: 'domcontentloaded' })
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message WireUp' }).fill('Build a joystick controlled arm with three servos')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    const card = page.getByRole('form', { name: 'Prototype feasibility review' })
    await expect(card).toContainText('Joystick cannot be wired accurately')
    expect((await (await request.get(`/api/hardware/projects/${project.id}`)).json()).components).toEqual([])
    await card.getByRole('radio', { name: 'Cancel without changing the project' }).check()
    await card.getByRole('button', { name: 'Confirm choice' }).click()
    await expect(page.getByRole('article', { name: 'WireUp message' }).last()).toContainText('Build cancelled', { timeout: 20000 })
    expect((await (await request.get(`/api/hardware/projects/${project.id}`)).json()).components).toEqual([])
    await page.reload()
    if (width < 900) await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(page.getByText('This review has already been answered.', { exact: false })).toBeVisible({ timeout: 30000 })
  })
}
