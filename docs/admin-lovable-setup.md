# เปิดใช้หน้าจัดการ CareBee ใน Lovable

สำหรับการส่งแจ้งเตือนเมื่อปิดเว็บและรับน้ำหนักผ่าน API ดู [คู่มือเปิดระบบเบื้องหลัง](mqtt-background-setup.th.md)

## บัญชีผู้ดูแล

1. ในระบบ Auth ของโปรเจกต์ CareBee ให้เปิดการลงชื่อเข้าใช้ด้วยอีเมลและรหัสผ่าน แล้วเตรียมบัญชีผู้ดูแลที่ยืนยันอีเมลเรียบร้อย
2. คัดลอก User ID (UUID) จากหน้า Users ของโปรเจกต์ CareBee remix มาแทน `<USER_UUID>` ใน [ไฟล์ให้สิทธิ์ผู้ดูแล](sql/grant-carebee-admin.sql) แล้วรันใน **Database → Manage → SQL editor** ตรวจว่าผลคืน UUID ของบัญชีที่ตั้งใจให้สิทธิ์
3. เปิด `/admin` ต่อท้าย URL ของ CareBee แล้วเข้าสู่ระบบด้วยอีเมลและรหัสผ่านบัญชีนั้น หากหน้าเว็บแจ้งว่าเข้าสู่ระบบสำเร็จแต่ต้องได้รับสิทธิ์ ให้ตรวจ UUID และโปรเจกต์ที่รัน SQL

แอปรองรับรายชื่อ UUID เดิมใน `CAREBEE_ADMIN_USER_IDS` หากตัวแปรเข้าถึงได้จากเซิร์ฟเวอร์ของเว็บ การถอนสิทธิ์ให้ลบ UUID ออกจากตัวแปรดังกล่าวด้วยถ้าเคยใช้ แล้วลบธงออกจากบัญชีด้วย SQL นี้ โดยแทน UUID ให้ตรงกับบัญชี

```sql
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data - 'carebee_admin'
WHERE id = '<USER_UUID>'::uuid;
```

หน้าแอดมินแก้ไขข้อมูลโปรไฟล์ (ชื่อ เบอร์โทร เขตเวลา) ข้อมูลกล่อง (ชื่อ) ข้อมูลยา (ชื่อ ยาคงเหลือ สถานะยา) และตารางทานยาที่ยังใช้งาน (เวลาและการเปิดแจ้งเตือน) ค้นจากรหัสรายการหรือรหัสเจ้าของได้

## แม่แบบ MQTT

ส่งคำขอนี้ให้ Lovable เพื่อสร้างตารางผ่าน migration ที่ Lovable จัดการ

> Create `public.mqtt_reminder_templates` with a text primary key `id` constrained to the single value `default`, and a required text column `template` with character length between 1 and 4096. Enable RLS, grant SELECT, INSERT, UPDATE, DELETE to `service_role` and revoke access to this table from `anon`, `authenticated`, and `PUBLIC`. Do not create direct access policies for end-user roles. The CareBee server authorizes an administrator before updating the template, and returns the template to the owner of a verified real box only when a reminder is due. Preserve the existing authentication settings and tables.

ใน `/admin` เปิดแท็บแม่แบบ JSON ใส่ JSON ที่กล่องต้องรับ ตรวจดูตัวอย่างผลลัพธ์ แล้วกดบันทึก ตัวอย่างส่งหมายเลขช่องเป็นตัวเลขและเวลาเป็นข้อความ

```json
{
  "command": "remind",
  "channel": "{{compartment}}",
  "time": "{{time}}"
}
```

แม่แบบกลางใช้กับการส่งแจ้งเตือนตามเวลาของกล่องจริงทุกใบผ่าน MQTT ที่เว็บเชื่อมต่ออยู่ ใช้ topic ตามค่าของแต่ละกล่อง การล้างแม่แบบแล้วกดบันทึกจะคืนค่าเดิมของแต่ละกล่อง

## แม่แบบรับค่าน้ำหนักจาก ESP32

ให้ Lovable สร้างตาราง `mqtt_sensor_templates` โดยใช้ [ไฟล์ SQL นี้](sql/enable-mqtt-sensor-template.sql) ใน migration ใหม่ หรือรันไฟล์ใน **Database → Manage → SQL editor** ของ CareBee remix เพื่อเปิดการบันทึกแม่แบบกลาง จากนั้นเข้า `/admin` → **แม่แบบ JSON รับค่าจาก ESP32** แม่แบบนี้ตั้งรูปแบบของเฟิร์มแวร์และเกณฑ์น้ำหนักกลางสำหรับกล่องจริง

ค่าเริ่มต้นรับ `type: "load_cell"`, `compartment` เป็นเลขช่อง 1–7 และ `weight_g` เป็นน้ำหนักหน่วยกรัม หากมี Load Cell ตัวเดียวชั่งทั้งกล่อง ให้ตั้ง `"compartmentPath": null` แล้ว ESP32 ส่งเฉพาะชนิดเหตุการณ์ คีย์กล่อง และน้ำหนัก เฟิร์มแวร์ที่ส่ง JSON ซ้อนสามารถใช้พาธแบบ `reading.grams` ใน `weightPath` ดูผลด้วยช่องตัวอย่างก่อนบันทึก หากยังไม่มีตารางตั้งค่า ระบบจะใช้รูปแบบเริ่มต้น

เพื่อทดสอบ ให้เชื่อมเว็บกับ MQTT แล้ว publish ไปที่ topic เซนเซอร์เต็มของกล่องที่ใช้ทดสอบ ปิด Retain และส่งค่าน้ำหนักที่นิ่งแล้ว โดยใช้คีย์อุปกรณ์ของกล่องนั้นกับ broker ที่ควบคุมได้

```json
{"type":"load_cell","device_key":"<คีย์ของกล่องทดสอบ>","compartment":1,"weight_g":12.4}
```

ส่งช่องเดิมอีกครั้งโดยเปลี่ยน `weight_g` เป็น `11.6` ค่าแรกใช้เป็นจุดอ้างอิง ครั้งที่สองน้ำหนักลด `0.8` กรัม จึงเกินเกณฑ์เริ่มต้น `0.5` กรัมและขึ้นเหตุการณ์ที่กล่องนั้น น้ำหนักที่ขยับต่ำกว่าเกณฑ์จะแสดงค่าล่าสุดโดยไม่เพิ่มเหตุการณ์ ใช้การยืนยันการทานยาแยกจากการรายงานน้ำหนัก

## ตรวจหลังเปิดใช้งาน

1. ลองเข้าจากบัญชีทั่วไปแล้วตรวจว่าหน้าแอดมินปฏิเสธการเข้าถึง
2. ใช้บัญชีผู้ดูแลบันทึกแม่แบบตัวอย่าง รีโหลดและเข้าสู่ระบบใหม่ แล้วตรวจว่าแม่แบบเดิมปรากฏ
3. ใช้กล่องและตารางทดสอบ เปิด MQTT จาก CareBee แล้ว subscribe topic ขาออกของกล่องใน MQTTX รอถึงเวลาที่ตั้งไว้และตรวจ JSON ที่ได้รับ

อ้างอิงการตรวจเซสชันและวิธีลงชื่อเข้าใช้ [Supabase JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields).
