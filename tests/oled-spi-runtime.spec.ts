import {expect,test} from '@playwright/test'
test('Uno OLED SPI follows actual SPI firmware and chip-select',async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'OLED SPI',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true);return r.json()}
 await command('add_component',{type:'ssd1306',id:'oled',properties:{protocol:'spi'},x:450,y:140})
 for(const [pin,target] of [['5V','VIN'],['GND','GND'],['11','DATA'],['13','CLK'],['10','CS'],['9','DC'],['8','RST']])await command('connect_wire',{from:{component:'board',pin},to:{component:'oled',pin:target}})
 await command('generate_firmware',{source:'#include <SPI.h>\nvoid setup(){pinMode(10,OUTPUT);pinMode(9,OUTPUT);pinMode(8,OUTPUT);digitalWrite(10,HIGH);digitalWrite(8,LOW);delay(10);digitalWrite(8,HIGH);SPI.begin();SPI.beginTransaction(SPISettings(1000000,MSBFIRST,SPI_MODE0));digitalWrite(10,LOW);digitalWrite(9,LOW);byte commands[]={0xAF,0x20,0,0x21,0,127,0x22,0,7};for(byte c:commands)SPI.transfer(c);digitalWrite(9,HIGH);for(int i=0;i<1024;i++)SPI.transfer(0xFF);digitalWrite(10,HIGH);SPI.endTransaction();}\nvoid loop(){}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 const lit=()=>page.locator('wokwi-ssd1306').evaluate(e=>{const image=(e as HTMLElement&{imageData?:ImageData}).imageData;return !!image&&Array.from(image.data).some((v,i)=>i%4!==3&&v>0)})
 await expect.poll(lit,{timeout:15000}).toBe(true)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect.poll(lit,{timeout:15000}).toBe(true)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
