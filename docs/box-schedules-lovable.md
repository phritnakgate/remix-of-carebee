# เปิดระบบยา 7 รอบใน Lovable

## งานแก้ต่อจาก migration ที่ Lovable สร้างแล้ว

การทดสอบ `save_box_medicine` จาก migration `0000_enable_seven_box_medicine_rounds` ใน PostgreSQL จำลองพบ `42702 column reference "owner_id" is ambiguous` เมื่อเลือกกล่องจริง สาเหตุอยู่ที่ `d.owner_id = owner_id` ใน query ของ `public.devices` เพราะชื่อตัวแปรตรงกับชื่อคอลัมน์

ให้ใช้ [ไฟล์ SQL สำหรับแก้ `owner_id`](sql/fix-save-box-medicine-owner-id.sql) กับฐานข้อมูลของ **CareBee remix** สคริปต์แก้ฟังก์ชันที่ติดตั้งอยู่ ตรวจรูปแบบก่อนแก้ และรันซ้ำได้

1. ส่งไฟล์ให้ Lovable ใช้ใน migration ใหม่ต่อจาก `0000_enable_seven_box_medicine_rounds` หรือเปิด **Database → Manage → SQL editor** ใน Lovable ของโปรเจกต์ remix แล้ววาง SQL ทั้งไฟล์และกด Run หากรันผ่าน SQL editor โดยตรง การเปลี่ยนแปลงจะอยู่ในฐานข้อมูลนั้น ส่วนประวัติ migration จะต้องบันทึกผ่าน Lovable เมื่อต้องนำไปใช้กับฐานข้อมูลอื่น
2. กลับไปหน้าเว็บ เข้าด้วย Google แล้วลองเพิ่มยา เลือกกล่องจริงของบัญชีตัวเอง ตั้งเช้าก่อนอาหารและเช้าหลังอาหาร จากนั้นแก้เวลาหนึ่งรอบและบันทึกอีกครั้ง

[วิธีรัน SQL ใน Lovable](https://docs.lovable.dev/features/database#run-sql-queries)

**ข้อความสำหรับ Lovable**

> สร้าง migration ตามหลัง `0000_enable_seven_box_medicine_rounds` เพื่อแก้ `public.save_box_medicine(uuid, jsonb, jsonb)` ให้เปลี่ยนชื่อตัวแปร PL/pgSQL `owner_id` เป็น `v_owner_id` และแก้จุดอ้างถึงตัวแปรทั้งหมด คงชื่อคอลัมน์และคีย์ JSON `owner_id` เดิม รักษา RLS, `can_access`, trigger และข้อมูลเดิม ใช้ migration กับฐานข้อมูลของ remix แล้วทดสอบเพิ่มและแก้ยาโดยเลือกกล่องจริงของเจ้าของและบันทึกสองรอบเช้า/เย็นก่อนและหลังอาหาร ตรวจว่าเลือกกล่องของบัญชีอื่นไม่ได้

## สเปกเดิมสำหรับอ้างอิง

แอปจะเปิดฟอร์ม 7 รอบเมื่อ `box_schedule_version()` คืน `1`

## ความสัมพันธ์

- `devices 1 → N medicines` เพิ่ม `medicines.device_id uuid null` อ้าง `devices.id` และ `ON DELETE SET NULL` ให้ผูกได้เฉพาะกล่อง `mode = 'real'` ของ `owner_id` เดียวกัน บังคับเงื่อนไขนี้ที่ฐานข้อมูลสำหรับทุกช่องทางเขียน ไม่ใช่แค่ในฟอร์ม ผู้ใช้ที่ยังไม่มีกล่องสามารถเก็บตารางไว้ติดตามในแอปได้
- `medicines 1 → N medication_schedules` เพิ่ม `box_slot text null` และ `ends_on date null` ใน `medication_schedules` คง `slot`, `dose_time`, `days_of_week`, `notify` และ Foreign Key เดิมที่ประวัติ `dose_logs` ใช้อยู่ `ends_on` เป็นวันสิ้นสุดแบบไม่รวมวันดังกล่าวตาม timezone เจ้าของยา
- ใช้ constraint ของ `box_slot` ให้รับเฉพาะรอบตามตารางหรือ `null` และ unique index บน `(medicine_id, box_slot)` สำหรับ `box_slot` ที่มีค่าและ `ends_on is null` เท่านั้น ตรวจ constraint เดิมที่อาจบังคับ unique `(medicine_id, slot)` และจำกัดให้ใช้เฉพาะรายการเดิมที่ `box_slot is null` และยังไม่สิ้นสุด เพื่อให้ก่อนและหลังอาหารอยู่ในช่วงหลักเดียวกันได้
- คง RLS ผ่าน `can_access(owner_id)` และคงข้อจำกัดการเขียนข้อมูลกล่องจริง ตรวจว่าเจ้าของของตารางยาและยาตรงกัน และรักษาการแยกอุปกรณ์จำลองออกจากกล่องจริง

| ช่อง | `box_slot` | `slot` เดิม | ค่าเริ่มต้นในฟอร์ม |
| --- | --- | --- | --- |
| 1 | `morning_before` | `morning` | 07:30 |
| 2 | `morning_after` | `morning` | 08:00 |
| 3 | `afternoon_before` | `afternoon` | 11:30 |
| 4 | `afternoon_after` | `afternoon` | 12:30 |
| 5 | `evening_before` | `evening` | 17:30 |
| 6 | `evening_after` | `evening` | 18:30 |
| 7 | `bedtime` | `bedtime` | 21:00 |

## RPC ที่โค้ดเรียก

ให้สร้าง `save_box_medicine(_medicine_id uuid, _medicine jsonb, _rounds jsonb)` ใช้สิทธิ์ผู้ใช้ที่ล็อกอินและทำทั้งหมดใน transaction เดียว คืนรหัสยา `uuid` เมื่อสำเร็จ

1. `_medicine_id` เป็น `null` ตอนเพิ่มยา `_medicine` มี `owner_id`, `name`, `dosage`, `quantity`, `pills_per_dose`, `food_instruction`, `compartment`, `color`, `notes`, `active`, `device_id` อ่านเฉพาะฟิลด์ที่อนุญาต ตรวจ `can_access(owner_id)` และตรวจความเป็นเจ้าของกล่องจริง ถ้าแก้ยาให้ล็อกแถวก่อน ตรวจ owner จากแถวเดิม และห้ามย้าย owner ฟิลด์ `food_instruction` และ `compartment` ระดับยาเก็บไว้สำหรับข้อมูลเดิม
2. `_rounds` เป็น array 1–7 รายการ รูป `{ "box_slot": "evening_after", "dose_time": "18:30" }` ตรวจค่าตามตาราง เวลาถูกต้อง และไม่ซ้ำ แปลง `slot` ตามตารางที่ฐานข้อมูล
3. รักษา `id`, `days_of_week` และ `notify` ของรอบที่ตรงกับข้อมูลเดิม ถ้าจะแปลงรอบเดิมที่ `box_slot` ว่าง ให้จับกับ `slot` เดิมและใช้ก่อนอาหารเมื่อ `food_instruction = 'before_food'` ใช้หลังอาหารสำหรับมื้ออื่น และใช้ `bedtime` สำหรับก่อนนอน ทำเมื่อมีการกดบันทึกเท่านั้น ห้ามย้ายข้อมูลเติมกล่องให้เอง ถ้ามีรายการเดิมซ้ำกันให้เลือกรายการแรกตามเวลาที่สร้างและ `id` อย่างคงที่ รายการที่ไม่ถูกเลือกให้สิ้นสุดตามข้อถัดไป
4. รอบที่ผู้ใช้ถอดออกให้ตั้ง `ends_on` เป็นวันที่ปัจจุบันใน timezone ของเจ้าของยา โดยเก็บแถวและ `dose_logs` เดิม รอบใหม่ใช้ค่าเริ่มต้นวันและการเตือนเดียวกับตารางยาที่มีอยู่ ตรวจและแก้กรณีแก้ไขพร้อมกันโดยคง unique index ไว้
5. เปิดสิทธิ์ execute เฉพาะผู้ใช้ที่ล็อกอิน ใช้ `SECURITY INVOKER` ถ้า RLS เดิมรองรับ หากต้องใช้ `SECURITY DEFINER` ให้จำกัด `search_path` ระบุ schema ของวัตถุและตรวจ `auth.uid()` กับ `can_access` ในฟังก์ชันก่อนอ่านหรือเขียน

เมื่อ schema และ RPC ใช้งานได้ครบ ให้สร้าง `box_schedule_version()` แบบคืน integer `1` สำหรับผู้ใช้ที่ล็อกอิน แล้ว regenerate Supabase types ผ่าน Lovable ตรวจการใช้งานกับเจ้าของกล่อง ผู้ดูแลที่เชื่อมไว้ ผู้ใช้ที่ไม่มีสิทธิ์ และข้อมูลยาเดิม อย่าแก้หรือลบข้อมูลย้อนหลังระหว่างทดสอบ

## ผลที่ต้องตรวจในแอป

- ยาหนึ่งรายการผูกได้กับกล่องจริงหนึ่งกล่อง เลือกได้หลายรอบ และตั้งเวลาแต่ละรอบแยกกัน ตารางยาและ Dashboard ใช้ชื่อรอบเดียวกัน
- รอบใหม่ส่ง MQTT ไปเฉพาะกล่องที่ผูกไว้ รอบในยาใหม่ที่ยังไม่ผูกกล่องใช้สำหรับติดตามในแอป ข้อมูลเดิมที่ยังไม่แปลงใช้การกำหนดยาใน MQTT ของแต่ละกล่องตามเดิม
- ทดสอบแก้ยาให้มีทั้งรอบเย็นก่อนอาหารและเย็นหลังอาหารในกล่องเดียวกัน ตรวจว่า payload ที่ส่งมี `box_slot`, `compartment`, `food_instruction` และ `time` ตรงกับรอบ จากนั้นลบรอบหนึ่งและตรวจว่าประวัติการยืนยันเดิมยังเปิดได้

สำหรับแม่แบบ JSON กลาง ดู [คู่มือเปิดใช้หน้าแอดมิน](admin-lovable-setup.md)
