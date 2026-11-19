# เปิดแจ้งเตือน MQTT ขณะปิดเว็บ

## เปิดระบบบน Lovable

โค้ด CareBee มีตัวส่งที่ `POST /api/jobs/mqtt` และตัวรับ Load Cell ที่ `POST /api/public/device/sensor`

1. ให้ Lovable ใช้ [SQL เปิดระบบ](sql/enable-mqtt-background.sql) ใน migration ใหม่ของ CareBee remix หรือรันใน **Database → Manage → SQL editor** ของ remix
2. รอ Lovable ซิงก์และเผยแพร่โค้ดล่าสุด [SQL เตรียมสถานะ](sql/activate-mqtt-background.sql) รันได้เพื่อเตรียมแถวสถานะ ซึ่งตัว job ก็สร้างให้ได้เองเมื่อเรียกครั้งแรก
3. ส่งข้อความต่อไปนี้ให้ Lovable ในโปรเจกต์ CareBee remix เพื่อสร้าง **managed Job** จากระบบของ Lovable

> สร้าง managed scheduled job ชื่อ carebee-mqtt-reminders ให้ส่ง POST ไปที่ API route /api/jobs/mqtt ของเว็บที่เผยแพร่จริง ทุกนาทีด้วย cron * * * * * ใช้ LOVABLE_CRON_SECRET ที่ Lovable จัดการให้ โดยโค้ดมี authenticateCronRequest รองรับแล้ว และใช้ Cloudflare waitUntil เพื่อส่ง MQTT หลังตอบรับงานแล้ว ใช้โค้ดและตาราง mqtt_background_configs, mqtt_deliveries, mqtt_job_state ที่มีอยู่ ให้ตรวจผ่าน More → Database → Manage → Jobs ว่า job ถูกสร้างและทำงานได้ หากมี job ชื่อเดียวกันให้ใช้เพียงรายการเดียว

4. เปิดเว็บ เข้าสู่ระบบ แล้วไป **กล่องยา → การตั้งค่า ESP32 · MQTT → แจ้งเตือนเมื่อปิดเว็บ** รอข้อความ **ตัวตั้งเวลาเบื้องหลังทำงานอยู่** ซึ่งอาจใช้ถึงหนึ่งนาที
5. เลือก HiveMQ หรือ EMQX ให้ตรงกับ ESP32 ตรวจ topic และ payload แล้วกด **เปิดใช้ด้วยการตั้งค่านี้** ระบบเริ่มจากรอบถัดไปที่ตั้งหลังเวลาเปิดใช้

การตั้งค่า broker และ payload ของงานเบื้องหลังถูกบันทึกในฐานข้อมูล ต้องกด **อัปเดตการตั้งค่าเบื้องหลัง** หลังแก้ค่า ปุ่ม **ตัดการเชื่อมต่อ** หยุดการเชื่อมต่อของแท็บ หากต้องการยกเลิกการส่งตอนปิดเว็บ ให้กด **หยุดแจ้งเตือนเบื้องหลัง**

SQL ที่รันตรงจาก editor จะเปลี่ยนฐานข้อมูลนั้น เมื่อให้ Lovable จัดการ migration ภายหลัง ให้นำไฟล์เปิดตารางไปบันทึกในประวัติ migration ด้วย ฐานข้อมูลของ CareBee ที่ตรวจพบมี pgcrypto และ supabase_vault ส่วน pg_cron และ pg_net ยังไม่มี จึงใช้ managed Job ของ Lovable สำหรับตั้งเวลา

## วิธีทำงาน

Lovable เรียกตัวตรวจทุกนาที ตัวตรวจยืนยัน credential ของ job แล้วอ่านรายการถึงเวลาจากฐานข้อมูล ถ้าไม่มีงานจะตอบกลับทันที ถ้ามีงานจะตอบ 202 เพื่อรับงานและส่งต่อให้การทำงานเบื้องหลังด้วย Cloudflare waitUntil ตัวส่งจึงเชื่อม broker ด้วย WSS ส่ง QoS 1 แล้วปิดการเชื่อมต่อ ESP32 ยังคงเชื่อม broker เดียวกันผ่าน TCP 1883 และ subscribe topic `medicine/schedule/{box-id}`

แนวทางนี้เรียก API ทุกนาทีเพื่อเช็กงาน และมีค่า Cloud usage ตามการเรียกจริง ส่วน MQTT จะเชื่อมเฉพาะเมื่อมีงาน

เวลาใช้ timezone เจ้าของยา รองรับวันทานยา การปิดแจ้งเตือน ยาที่หยุดใช้ และวันสิ้นสุดตาราง ตรวจยืนยันการทานยาก่อนส่ง งานนี้บันทึกเฉพาะประวัติการส่งใน `mqtt_deliveries`

ข้อความที่ส่งสำเร็จจะไม่ถูกส่งซ้ำโดย job รอบถัดไป งานที่ส่งล้มเหลวลองใหม่ได้สูงสุด 3 ครั้ง ภายในนาทีที่ตั้งและอีก 2 นาทีถัดไป งานที่เก่าเกินช่วงนี้จะหมดโอกาสส่งเพื่อเลี่ยงการแจ้งเตือนล่าช้ามาก ระดับ MQTT QoS 1 อาจส่งซ้ำเมื่อเครือข่ายขาดช่วง ให้เฟิร์มแวร์เก็บ `notification_id` ที่จัดการแล้วและข้ามข้อความรหัสเดิม

แม่แบบกลางใน `/admin` ใช้กับตัวส่งเบื้องหลังด้วย ถ้าใช้ JSON ที่กำหนดเอง แนะนำให้มีรหัสดังนี้

```json
{
  "notification_id": "{{notification_id}}",
  "command": "remind",
  "channel": "{{compartment}}",
  "time": "{{time}}"
}
```

กล่อง ESP32 ต้องเปิดและเชื่อมอินเทอร์เน็ตเพื่อรับข้อความ การยืนยันจาก broker แสดงว่ารับข้อความส่งแล้ว หากต้องการยืนยันว่ากล่องทำงานจริง ให้เฟิร์มแวร์รายงานสถานะหรือการยืนยันการทานยากลับมา

## ส่งค่าน้ำหนักโดยปิดเว็บได้

ให้ ESP32 ส่ง HTTPS เมื่อได้น้ำหนักที่นิ่งแล้ว โดยใช้รหัสอุปกรณ์ใน header

```http
POST /api/public/device/sensor
Content-Type: application/json
X-Device-Key: <คีย์ลับของกล่องนั้น>

{"type":"load_cell","compartment":1,"weight_g":12.4}
```

ใช้ URL เต็มของเว็บที่เผยแพร่จริง ข้อความใช้แม่แบบรับค่าจาก ESP32 ใน `/admin` เดียวกับ MQTT ถ้าใช้ Load Cell ตัวเดียวชั่งทั้งกล่อง ให้ตั้ง `compartmentPath` เป็น `null` และส่ง JSON ที่มี `type` กับ `weight_g` ค่าครั้งแรกเป็นค่าอ้างอิง หลังเปลี่ยนถึงเกณฑ์จึงบันทึกเหตุการณ์เพิ่มหรือลดน้ำหนักให้กล่องที่ผ่านการตรวจคีย์

เมื่อส่งไม่สำเร็จ ให้ ESP32 รอและลองใหม่โดยคงลำดับข้อมูล การส่ง API นี้ใช้ได้โดยไม่มีเซสชันของผู้ใช้และไม่มีแท็บเว็บเปิดอยู่

## ทดสอบหลังเปิดระบบ

1. ตั้งแจ้งเตือนของกล่องทดลองให้ห่างจากปัจจุบัน 3–5 นาที เปิดงานเบื้องหลัง แล้วปิดแท็บ CareBee ทุกแท็บ
2. ใน MQTTX เชื่อม broker เดียวกัน แล้ว subscribe topic แจ้งเตือนเต็มของกล่องก่อนถึงเวลา
3. ตรวจว่าได้รับข้อความภายในประมาณหนึ่งนาทีบวกเวลาเชื่อมต่อ เปิด CareBee ใหม่เพื่อตรวจเวลาที่ broker ยืนยันล่าสุด
4. ปิด CareBee อีกครั้ง แล้วส่ง API ค่าน้ำหนัก 12.4 ตามด้วย 11.6 กรัม ตรวจสถานะและกิจกรรมหลังเปิดเว็บใหม่
5. กดหยุดแจ้งเตือนเบื้องหลัง แล้วตั้งรอบทดสอบใหม่ ตรวจว่าไม่มีข้อความจาก job

ดูว่า timer ทำงานจริงด้วย SQL

```sql
SELECT last_tick_at, last_run_at FROM public.mqtt_job_state WHERE id = 'default';
SELECT device_id, schedule_id, scheduled_date, status, attempts, sent_at
FROM public.mqtt_deliveries ORDER BY scheduled_date DESC LIMIT 30;
```

`last_tick_at` ควรขยับทุกนาที ส่วน `last_run_at` จะขยับเมื่อมีงานที่ต้องส่ง ตรวจ job และประวัติการเรียกที่ **More → Database → Manage → Jobs** หาก job ตอบ 202 ให้ตรวจผลส่งจริงจาก `mqtt_deliveries` และเวลาที่ broker ยืนยันในหน้ากล่อง

รายละเอียดอ้างอิง [Jobs ของ Lovable](https://docs.lovable.dev/features/jobs) และ [Cloudflare waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)
