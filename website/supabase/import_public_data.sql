-- ══════════════════════════════════════════════════════════════════════════════
-- IMPORT ALL PROFILES, MACHINE BINDINGS, DEVICES, RENTALS & ASSIGNMENTS
-- Run this in your NEW Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Import Profiles (sammyseth260@gmail.com is Seed Admin)
INSERT INTO public.profiles (id, email, role, super_admin_id, is_blocked, blocked_reason, blocked_by, created_at, updated_at) VALUES
  ('76eeb120-1ea5-44a5-b924-0f5968ad5ae6', 'sammyseth260@gmail.com', 'seed_admin', NULL, false, NULL, NULL, '2026-07-31T10:34:55.995497+00:00', '2026-07-31T10:34:55.995497+00:00'),
  ('707001e5-25b8-4d6f-b9a3-9fc501ec52e5', 'leonardtarus71@gmail.com', 'super_admin', NULL, false, NULL, NULL, '2026-07-31T10:40:33.008653+00:00', '2026-07-31T10:51:50.232+00:00'),
  ('0b3879b9-c823-434c-9c8f-12d2ff7f8f91', 'collinsbet50@gmail.com', 'super_admin', NULL, false, NULL, NULL, '2026-07-31T10:42:49.147009+00:00', '2026-07-31T11:48:14.337+00:00'),
  ('a3b92bff-63f3-4d2f-8d20-556438e210d3', 'kipkorirmutai27@gmail.com', 'super_admin', NULL, false, NULL, NULL, '2026-07-31T11:42:29.462619+00:00', '2026-08-09T19:17:28.234+00:00'),
  ('308236a0-a5e6-4c70-80f0-c5b60aba57ec', 'warslaysamm@gmail.com', 'super_admin', NULL, false, NULL, NULL, '2026-07-31T22:53:49.096475+00:00', '2026-08-09T20:12:58.808+00:00'),
  ('8578324b-1e59-4fec-8423-20546173cb86', 'kibetngeno428@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-07-31T21:40:58.744074+00:00', '2026-07-31T21:40:58.744074+00:00'),
  ('95daa7dc-c17a-4caf-bf39-1fc03ed117be', 'kiptoolenny36@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-07T17:42:46.484882+00:00', '2026-08-07T17:42:46.484882+00:00'),
  ('019443f6-50cf-4560-824f-27cd93a4e30b', 'mosesalex9902@gmail.com', 'worker', NULL, true, 'Suspended by Admin', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '2026-07-31T21:29:51.824347+00:00', '2026-08-08T07:37:25.973+00:00'),
  ('9818bf20-c42d-4b84-9885-64277ba5eb62', 'kiproprono03@gmail.com', 'worker', NULL, true, 'Suspended by Admin', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '2026-07-31T21:41:04.31352+00:00', '2026-08-08T07:37:59.14+00:00'),
  ('9c0ff971-83df-4540-af4b-92e9ed79240d', 'nicholusmwariri40@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-07T18:02:03.586056+00:00', '2026-08-09T19:56:42.129+00:00'),
  ('dfddbc44-d861-4d34-8fed-5ac5071ebcd9', 'bettnicki647@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-07T07:50:11.092+00:00', '2026-08-10T09:47:19.791+00:00'),
  ('337707f5-9573-47da-a613-1eb80a6f62f0', 'nickkipkoech5@gmail.com', 'worker', NULL, true, 'Suspended by Admin', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '2026-08-07T16:49:52.040505+00:00', '2026-08-10T09:47:33.68+00:00'),
  ('853b0d9c-6b74-4699-b606-05abd8ac3df9', 'mat@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-09T20:58:24.285916+00:00', '2026-08-10T22:43:48.844+00:00'),
  ('b0c2be32-df91-47a4-8898-90ab2f6df85b', 'justicekipkemoi2006@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-11T06:14:20.259787+00:00', '2026-08-11T06:14:20.259787+00:00'),
  ('42033b6d-38ef-4354-9253-968abcefe026', 'vintarus1@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-12T10:00:45.155157+00:00', '2026-08-12T10:11:12.444+00:00'),
  ('cdfa9620-b1fa-4693-908f-fa17409f467c', 'jacobreed6232@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-13T22:53:25.023597+00:00', '2026-08-13T22:53:25.023597+00:00'),
  ('59427519-8043-4425-9e0b-019db51b1b2c', 'cnahashon51@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-13T23:04:00.484715+00:00', '2026-08-13T23:04:00.484715+00:00'),
  ('c7ba5c95-79ad-403f-a6e2-8bb1f6066b76', 'vintarus4@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-13T23:05:47.554639+00:00', '2026-08-13T23:05:47.554639+00:00'),
  ('1c19d8b0-6127-4230-a07c-67786ad4ca76', 'kipngetichkenneth184@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-15T19:35:19.890711+00:00', '2026-08-15T19:35:19.890711+00:00'),
  ('578da9f3-9fed-4f48-9f1a-8ea586ad62b5', 'collins20collo@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-17T11:32:22.318269+00:00', '2026-08-17T11:32:22.318269+00:00'),
  ('8b2d784f-a221-49b4-a4c5-30ca3608e104', 'isabellajenkins348@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-17T13:37:18.436841+00:00', '2026-08-17T13:37:18.436841+00:00'),
  ('7c65fb78-552c-4479-b290-dbd08bb0fb81', 'matatasam.ai@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-17T13:52:51.947187+00:00', '2026-08-17T13:52:51.947187+00:00'),
  ('69b9955c-0df6-46af-9b4b-8a909afcf4dc', 'kenn19599@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-19T07:46:42.796576+00:00', '2026-08-19T07:46:42.796576+00:00'),
  ('33fa0532-4007-4e94-a7ca-4ebfad585bf5', 'timookorir@gmail.com', 'worker', NULL, true, 'suspended', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '2026-08-13T23:08:27.828665+00:00', '2026-08-19T07:47:24.175+00:00'),
  ('43ff12a8-2d31-409b-9fff-3edb2f7a7af9', 'tkoech779@gmail.com', 'worker', NULL, false, NULL, NULL, '2026-08-17T21:37:11.801689+00:00', '2026-08-19T08:04:59.826+00:00')
ON CONFLICT (id) DO UPDATE SET 
  role = EXCLUDED.role,
  is_blocked = EXCLUDED.is_blocked,
  blocked_reason = EXCLUDED.blocked_reason,
  blocked_by = EXCLUDED.blocked_by,
  super_admin_id = EXCLUDED.super_admin_id;

-- 2. Import Machine Bindings
INSERT INTO public.machine_bindings (id, binding_code, machine_name, super_admin_id, is_licensed, license_mode, license_note, created_at, updated_at) VALUES
  ('8124ed0c-544f-4037-a797-63f881cc17c9', '19182109', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T16:52:44.02654+00:00', '2026-07-31T18:39:07.666+00:00'),
  ('c358ab7d-0660-4542-8b80-7f3ce345207f', '11014040', 'DENNIS', NULL, true, 'licensed', 'Active', '2026-08-14T15:59:43.048604+00:00', '2026-08-22T07:03:53.65+00:00'),
  ('ce071a22-dac4-4cae-af0a-706261930be8', '63460176', 'DENNIS', NULL, true, 'licensed', 'Active', '2026-08-06T07:08:51.931973+00:00', '2026-08-14T05:53:17.873+00:00'),
  ('093830c7-1c1f-4ce8-95a1-b00ba712571d', '94879348', 'VERTEXT', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', true, 'licensed', 'Active', '2026-08-02T16:19:40.866802+00:00', '2026-08-09T18:18:41.157+00:00'),
  ('3cc8cc64-86e2-46bf-a3a4-feae1c3261da', '71721632', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T11:09:36.669305+00:00', '2026-08-07T16:36:52.795+00:00'),
  ('20736c6e-8662-4483-bd19-5f39f0bf24bc', '83416352', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T19:22:21.118019+00:00', '2026-07-31T19:26:41.474+00:00'),
  ('4a4ab325-db6a-4be6-ad90-d1db39e8a581', '96049531', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T14:18:31.000235+00:00', '2026-07-31T14:18:22.597+00:00'),
  ('f7ed56c1-f772-4e8d-9a59-18d16d0d0809', '50090096', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T19:27:05.540912+00:00', '2026-07-31T19:29:31.925+00:00'),
  ('e69c09ab-a36e-4bf6-9099-184924c1e6f9', '63478186', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T14:19:53.562351+00:00', '2026-07-31T14:19:45.033+00:00'),
  ('98412c34-cb58-4061-bd85-0e19361b338c', '18065189', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T14:48:42.198215+00:00', '2026-07-31T14:48:33.475+00:00'),
  ('39107207-f57d-4e54-ae90-c05c04a1b414', '44840380', 'DENNIS', NULL, true, 'licensed', 'Active', '2026-08-14T12:34:28.373884+00:00', '2026-08-14T12:35:45.837+00:00'),
  ('fc1c4cc2-5b77-48b2-9f5c-56083ff72fa9', '17132833', 'DESKTOP-HBV8NFP', NULL, true, 'licensed', 'Active', '2026-07-31T19:30:05.381977+00:00', '2026-07-31T19:31:01.588+00:00'),
  ('18fbd45b-6d2e-42b4-8cc9-9da9e89d9e85', '14412529', 'DENNIS', NULL, true, 'licensed', 'Active', '2026-08-10T20:49:10.740415+00:00', '2026-08-14T14:53:54.599+00:00'),
  ('4cfeea94-6bf6-411f-95e0-5a28330af79c', '25346984', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T12:38:14.745225+00:00', '2026-07-31T19:35:39.478+00:00'),
  ('60182cb0-f8b0-4619-b07d-f54ae8752b38', '39658666', 'LENOVO', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', true, 'licensed', 'Active', '2026-07-31T10:37:25.150589+00:00', '2026-07-31T12:05:23.457+00:00'),
  ('7935f809-df5c-4124-8e47-7f9783a92ffb', '92467154', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T10:57:14.269104+00:00', '2026-07-31T12:05:25.513+00:00'),
  ('6c7b5aab-8e6b-4557-a3c8-ccae90150dc8', '52127110', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T10:53:46.180669+00:00', '2026-07-31T12:05:27.161+00:00'),
  ('a0330f34-dd43-422c-ae0a-e71d178779ba', '99498676', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T10:55:59.825717+00:00', '2026-07-31T12:05:28.826+00:00'),
  ('9014bb7d-6510-4171-b233-3a66a975c13c', '82095018', 'LENOVO', NULL, true, 'licensed', 'Active', '2026-07-31T10:52:17.617271+00:00', '2026-07-31T12:05:30.705+00:00'),
  ('bf781bd1-5b32-45d4-a5d7-49167bd5e680', '10193272', 'DESKTOP-HBV8NFP', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', true, 'licensed', 'Active', '2026-07-31T13:56:06.577123+00:00', '2026-08-07T10:38:56.839+00:00')
ON CONFLICT (binding_code) DO NOTHING;

-- 3. Import Devices
INSERT INTO public.devices (
  id, serial, model, brand, stream_url, local_url, port, binding_code, status, 
  is_deleted_from_view, is_available_for_rental, monthly_rental_price, rented_by_user_id, 
  rental_status, rented_at, last_seen, created_at, updated_at
) VALUES
  ('b648d6e7-a82f-4bd3-8ca7-4396fd465e45', '1120308025024495', 'B170D', 'BLU', 'https://stream.diamt.cloud/?udid=1120308025024495&pin=11014040', NULL, 8100, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:58.192+00:00', '2026-08-07T06:56:57.715013+00:00', '2026-08-22T08:14:58.192+00:00'),
  ('6ae4df31-0c37-4146-adbd-6284c426e559', 'R92Y10PMLWD', 'SM-A055F', 'samsung', 'https://identifying-epinions-shopper-storm.trycloudflare.com/?udid=R92Y10PMLWD', 'http://localhost:8102', 8102, '71721632', 'offline', true, false, 49, NULL, 'available', NULL, '2026-07-31T19:51:25.332+00:00', '2026-07-31T10:54:04.623364+00:00', '2026-08-09T20:14:54.896+00:00'),
  ('b3ab2731-c9f0-4137-a284-8d197a39c641', '7070016025067254', 'B1660V', 'BLU', 'https://stream.diamt.cloud/?udid=7070016025067254&pin=11014040', NULL, 8101, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:58.42+00:00', '2026-08-07T06:57:07.624982+00:00', '2026-08-22T08:14:58.42+00:00'),
  ('8f968d45-1178-4260-ab27-e641e7772c6b', 'M769UCQCDMZLPF8D', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=M769UCQCDMZLPF8D&pin=11014040', NULL, 8102, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:58.627+00:00', '2026-08-09T19:03:42.710236+00:00', '2026-08-22T08:14:58.627+00:00'),
  ('5ef436c8-0da9-4c68-9c46-2d3cc673a9b5', 'NBIR5LAYORLRDU4T', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=NBIR5LAYORLRDU4T&pin=11014040', NULL, 8103, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:58.842+00:00', '2026-08-09T18:56:27.83144+00:00', '2026-08-22T08:14:58.842+00:00'),
  ('a66be2f9-9e15-48db-a6a7-628361f42d13', 'OBOFP75LXGV4EIJN', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=OBOFP75LXGV4EIJN&pin=11014040', NULL, 8104, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:59.056+00:00', '2026-08-07T06:57:17.685145+00:00', '2026-08-22T08:14:59.056+00:00'),
  ('7b03e1c9-3860-49ed-8bfd-fc863f9515c4', '102892535Q103674', 'TECNO CK8n', 'TECNO', 'https://commander-recreation-obituaries-organisation.trycloudflare.com/?udid=102892535Q103674&key=hyperflex1977ljc&pin=957807', 'http://localhost:8101', 8101, '71721632', 'offline', true, false, 49, NULL, 'available', NULL, '2026-07-31T23:19:41.849+00:00', '2026-07-31T10:57:23.22401+00:00', '2026-08-13T21:22:06.067+00:00'),
  ('56351d73-346f-48ac-b4ea-56d342b4b8ce', 'V8RGXC5D5LMJJRQW', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=V8RGXC5D5LMJJRQW&pin=11014040', NULL, 8105, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:59.265+00:00', '2026-08-07T06:57:28.025827+00:00', '2026-08-22T08:14:59.266+00:00'),
  ('ac963c9d-2216-42be-a961-ee194f8a729c', 'W45989YDRW8LIFYT', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=W45989YDRW8LIFYT&pin=11014040', NULL, 8106, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:59.471+00:00', '2026-08-09T18:59:03.414692+00:00', '2026-08-22T08:14:59.471+00:00'),
  ('5aa6eaab-fc22-4b78-b872-54545895b0d8', 'YTCY999TVKVCZDZX', 'T513V', 'TCL', 'https://stream.diamt.cloud/?udid=YTCY999TVKVCZDZX&pin=11014040', NULL, 8107, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:59.68+00:00', '2026-08-06T07:21:38.241853+00:00', '2026-08-22T08:14:59.68+00:00'),
  ('cfefd4cc-9b8c-4e93-b5e2-eceb3ba81f1b', 'ZA223HQMXQ', 'moto g - 2025', 'motorola', 'https://stream.diamt.cloud/?udid=ZA223HQMXQ&pin=11014040', NULL, 8108, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:14:59.9+00:00', '2026-08-07T06:57:39.566326+00:00', '2026-08-22T08:14:59.9+00:00'),
  ('3a8b7555-8cf5-4228-81ba-5386d603fc91', 'R8YWA0A09JW', 'SM-A042F', 'samsung', 'https://define-counsel-witness-call.trycloudflare.com/?udid=R8YWA0A09JW&key=streamalpha2707l&pin=830099', 'http://localhost:8100', 8100, '94879348', 'online', true, false, 49, NULL, 'available', NULL, '2026-08-09T18:18:54.917+00:00', '2026-07-31T10:37:35.21605+00:00', '2026-08-13T21:22:07.994+00:00'),
  ('16059ced-42f9-4937-a144-d4d0c1a5f024', 'ZA223HRJVF', 'moto g - 2025', 'motorola', 'https://stream.diamt.cloud/?udid=ZA223HRJVF&key=blazenexus6625cd&pin=823887', NULL, 8109, '11014040', 'online', false, true, 80, NULL, 'available', NULL, '2026-08-22T08:15:00.165+00:00', '2026-08-09T18:58:39.581432+00:00', '2026-08-22T08:15:00.165+00:00')
ON CONFLICT (serial) DO UPDATE SET 
  stream_url = EXCLUDED.stream_url,
  status = EXCLUDED.status,
  monthly_rental_price = EXCLUDED.monthly_rental_price,
  is_available_for_rental = EXCLUDED.is_available_for_rental,
  is_deleted_from_view = EXCLUDED.is_deleted_from_view;

-- 4. Import Device Rentals
INSERT INTO public.device_rentals (
  id, serial_number, user_id, device_model, device_brand, monthly_fee, 
  currency, status, binding_code, stream_url, expires_at, created_at, updated_at, stealth_root_enabled
) VALUES
  ('9c82f5d4-ba5a-4cdd-b833-1bca1078468f', '1120308025024495', 'RENTAL_USER_DEFAULT', 'B170D', 'BLU', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=1120308025024495&pin=11014040', NULL, '2026-08-13T18:29:14.616059+00:00', '2026-08-22T08:14:58.306+00:00', true),
  ('915461de-9b05-425a-b205-caf2b9050b77', '7070016025067254', 'RENTAL_USER_DEFAULT', 'B1660V', 'BLU', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=7070016025067254&pin=11014040', NULL, '2026-08-13T18:29:20.074044+00:00', '2026-08-22T08:14:58.527+00:00', true),
  ('1e4c8a1d-0650-4bb9-8363-7741b6eeea43', 'M769UCQCDMZLPF8D', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=M769UCQCDMZLPF8D&pin=11014040', NULL, '2026-08-13T18:29:25.010403+00:00', '2026-08-22T08:14:58.731+00:00', true),
  ('6099c73a-a215-4266-8ee4-68ece322df0e', 'NBIR5LAYORLRDU4T', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=NBIR5LAYORLRDU4T&pin=11014040', NULL, '2026-08-13T18:29:30.120813+00:00', '2026-08-22T08:14:58.948+00:00', true),
  ('6e8c816f-d93d-44c3-9e19-b154cd595ab6', 'OBOFP75LXGV4EIJN', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=OBOFP75LXGV4EIJN&pin=11014040', NULL, '2026-08-13T18:29:35.421327+00:00', '2026-08-22T08:14:59.157+00:00', true),
  ('281802d4-1d53-4394-aae4-7150ad05dd7f', 'V8RGXC5D5LMJJRQW', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=V8RGXC5D5LMJJRQW&pin=11014040', NULL, '2026-08-13T18:29:40.883034+00:00', '2026-08-22T08:14:59.366+00:00', true),
  ('25af8c65-0770-4efa-a95b-56f1aea1ba2a', 'W45989YDRW8LIFYT', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=W45989YDRW8LIFYT&pin=11014040', NULL, '2026-08-13T18:29:47.048995+00:00', '2026-08-22T08:14:59.579+00:00', true),
  ('197b7693-3043-4bc0-960d-f90d28a9edc0', 'YTCY999TVKVCZDZX', 'RENTAL_USER_DEFAULT', 'T513V', 'TCL', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=YTCY999TVKVCZDZX&pin=11014040', NULL, '2026-08-13T18:29:53.117078+00:00', '2026-08-22T08:14:59.783+00:00', true),
  ('83ba0981-58c4-461b-87fc-4a99f5b29f1e', 'ZA223HQMXQ', 'RENTAL_USER_DEFAULT', 'moto g - 2025', 'motorola', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=ZA223HQMXQ&pin=11014040', NULL, '2026-08-13T18:30:00.877127+00:00', '2026-08-22T08:15:00.051+00:00', true),
  ('8aa0c061-427a-466d-a4f2-1d306eb29719', 'ZA223HRJVF', 'RENTAL_USER_DEFAULT', 'moto g - 2025', 'motorola', 30, 'USD', 'active', '11014040', 'https://stream.diamt.cloud/?udid=ZA223HRJVF&key=blazenexus6625cd&pin=823887', NULL, '2026-08-13T18:30:08.081505+00:00', '2026-08-22T08:15:00.279+00:00', true)
ON CONFLICT (serial_number) DO UPDATE SET 
  stream_url = EXCLUDED.stream_url,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

-- 5. Import Device Assignments
INSERT INTO public.device_assignments (
  id, device_id, assigned_to_user_id, assigned_by_user_id, access_password, created_at, updated_at
) VALUES
  ('6293976b-9d5f-4b6a-99ce-1c330ce6975d', '6ae4df31-0c37-4146-adbd-6284c426e559', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', '759091', '2026-07-31T11:18:30.182203+00:00', '2026-07-31T11:18:30.182203+00:00'),
  ('883bd8a7-0f46-4397-a12c-6c63875aaf85', '5ef436c8-0da9-4c68-9c46-2d3cc673a9b5', '59427519-8043-4425-9e0b-019db51b1b2c', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '653961', '2026-08-13T23:11:42.099705+00:00', '2026-08-13T23:11:42.099705+00:00'),
  ('1a68b3bb-039b-4362-a4e2-0ae9e9b160e5', 'b3ab2731-c9f0-4137-a284-8d197a39c641', '95daa7dc-c17a-4caf-bf39-1fc03ed117be', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '917818', '2026-08-08T07:37:47.529069+00:00', '2026-08-13T21:21:56.305+00:00'),
  ('af32fd5a-88e5-4754-820a-17961d261449', '3a8b7555-8cf5-4228-81ba-5386d603fc91', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', '830099', '2026-07-31T10:40:55.604358+00:00', '2026-08-13T21:22:09.993+00:00'),
  ('e7919555-79eb-485f-9328-f57d634515c3', '3a8b7555-8cf5-4228-81ba-5386d603fc91', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', '830099', '2026-07-31T10:43:12.069782+00:00', '2026-08-13T21:22:09.993+00:00'),
  ('d3b90daa-9de6-4309-9762-f540ae8c4a65', '3a8b7555-8cf5-4228-81ba-5386d603fc91', 'a3b92bff-63f3-4d2f-8d20-556438e210d3', 'a3b92bff-63f3-4d2f-8d20-556438e210d3', '830099', '2026-07-31T11:45:12.241786+00:00', '2026-08-13T21:22:09.993+00:00'),
  ('3bbb80f9-5f78-4479-86f0-c9162387f451', 'b648d6e7-a82f-4bd3-8ca7-4396fd465e45', 'dfddbc44-d861-4d34-8fed-5ac5071ebcd9', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '807389', '2026-08-17T20:03:20.513429+00:00', '2026-08-18T00:19:02.958+00:00'),
  ('32ec3f35-4580-4358-81ad-1fbb4550b351', 'a66be2f9-9e15-48db-a6a7-628361f42d13', 'c7ba5c95-79ad-403f-a6e2-8bb1f6066b76', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '604098', '2026-08-13T23:11:02.640103+00:00', '2026-08-13T23:11:02.640103+00:00'),
  ('e0d0e3f5-122b-4e2f-9f3e-f885cec9444a', '5aa6eaab-fc22-4b78-b872-54545895b0d8', 'b0c2be32-df91-47a4-8898-90ab2f6df85b', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '231606', '2026-08-11T14:33:02.777877+00:00', '2026-08-11T14:33:02.777877+00:00'),
  ('d23994eb-643b-4fae-9518-8759684da3ec', '8f968d45-1178-4260-ab27-e641e7772c6b', '43ff12a8-2d31-409b-9fff-3edb2f7a7af9', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '281494', '2026-08-19T08:05:44.380599+00:00', '2026-08-19T08:05:44.380599+00:00'),
  ('f8edfc8b-b124-48e5-9d4a-068bc3c354bf', '16059ced-42f9-4937-a144-d4d0c1a5f024', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '823887', '2026-08-18T19:07:16.54731+00:00', '2026-08-18T19:07:16.54731+00:00'),
  ('33bdfa95-edd1-4925-ba6b-bed1ffd31ab1', 'ac963c9d-2216-42be-a961-ee194f8a729c', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '747609', '2026-08-11T17:57:02.956077+00:00', '2026-08-13T21:25:41.862+00:00'),
  ('f6b06c07-04b5-456f-a34c-d4c83e47ffa6', 'cfefd4cc-9b8c-4e93-b5e2-eceb3ba81f1b', '8578324b-1e59-4fec-8423-20546173cb86', '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', '391889', '2026-08-07T07:40:14.542713+00:00', '2026-08-13T21:21:40.353+00:00'),
  ('59d1889b-81af-43cd-8d00-e3dbb739ddd6', '56351d73-346f-48ac-b4ea-56d342b4b8ce', 'cdfa9620-b1fa-4693-908f-fa17409f467c', '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', '834114', '2026-08-13T22:55:29.686435+00:00', '2026-08-13T22:55:29.686435+00:00')
ON CONFLICT (id) DO UPDATE SET
  access_password = EXCLUDED.access_password,
  updated_at = EXCLUDED.updated_at;
