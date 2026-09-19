let cfg = {};
try {
  cfg = require('./config.json');
} catch (_) {}

const url = process.env.SUPABASE_URL || cfg.supabaseUrl || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || cfg.supabaseServiceRoleKey || '';

if (!url || !serviceKey) {
  console.error('Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in config.json or environment variables.');
  process.exit(1);
}

const USERS = [
  { id: '76eeb120-1ea5-44a5-b924-0f5968ad5ae6', email: 'sammyseth260@gmail.com', pwdHash: '$2a$10$R8Ja2HH2xNgIP0JKf03AvurGuS2w/ynGyCwnrKXxiP.gucV57p2y.' },
  { id: '707001e5-25b8-4d6f-b9a3-9fc501ec52e5', email: 'leonardtarus71@gmail.com', pwdHash: '$2a$10$p3VdWihwMbhiYED5ZY3.LeCzpW74B.4D9ErbhinvmkeWEwfUmmduK' },
  { id: '0b3879b9-c823-434c-9c8f-12d2ff7f8f91', email: 'collinsbet50@gmail.com', pwdHash: '$2a$10$2ZEKHoLk.flBruszKSITAelQjYy5AiIhh03V2KMEWtpsRrkOb6Z3q' },
  { id: 'a3b92bff-63f3-4d2f-8d20-556438e210d3', email: 'kipkorirmutai27@gmail.com', pwdHash: '$2a$10$affISRIzu44HiU3kyj66y.TntHLOtu3kjIMR8hxKb5FmFFJd4I6ku' },
  { id: '308236a0-a5e6-4c70-80f0-c5b60aba57ec', email: 'warslaysamm@gmail.com', pwdHash: '$2a$10$8UebwrOlyBELn55JfIORMu5VrRh5fHjEHmDsLXwokxn7/juyBW3vS' },
  { id: '8578324b-1e59-4fec-8423-20546173cb86', email: 'kibetngeno428@gmail.com', pwdHash: '$2a$10$XvtephRUhpdFh9TyXHcgEuJ8SzdRf/o7kEur/wWjo11fDdx1QL5la' },
  { id: '95daa7dc-c17a-4caf-bf39-1fc03ed117be', email: 'kiptoolenny36@gmail.com', pwdHash: '$2a$10$ldN0E3.MJAIOp3nHe5T0qOxqybOBpQAmAfG8p5X0MMKlWVf24YRCi' },
  { id: '019443f6-50cf-4560-824f-27cd93a4e30b', email: 'mosesalex9902@gmail.com', pwdHash: '$2a$10$wZpLNr./HULbCHYpQq1SYeHiwu97z4K1Xe0y7X/5/w9Gz9RYoVNZ2' },
  { id: '9818bf20-c42d-4b84-9885-64277ba5eb62', email: 'kiproprono03@gmail.com', pwdHash: '$2a$10$rHhCG5ybD5CuYn/vgJR4veT5A5p3s5RxuD1Sr9otv.gTOHoAp1x1K' },
  { id: '9c0ff971-83df-4540-af4b-92e9ed79240d', email: 'nicholusmwariri40@gmail.com', pwdHash: '$2a$10$l6h0.JWj8n.b.z6Z8e8KL.F1mAqXlBd/EVP3K4H179Co2qN5U9DPW' },
  { id: 'dfddbc44-d861-4d34-8fed-5ac5071ebcd9', email: 'bettnicki647@gmail.com', pwdHash: '$2a$10$VKxcMBiPyIpJ4rzopR0ehurR1iDHRD23X8FSGJIvWCwaO51AZunM6' },
  { id: '337707f5-9573-47da-a613-1eb80a6f62f0', email: 'nickkipkoech5@gmail.com', pwdHash: '$2a$10$rUzT6Z8pnzCw6dLivCCPmuv8IyxCNYR/4pt9qIjNdMbkvqJzBK2Ka' },
  { id: '853b0d9c-6b74-4699-b606-05abd8ac3df9', email: 'mat@gmail.com', pwdHash: '$2a$10$dUXEjKYAOdGsAhn.myqMUOd3Q6bQx.MNbiBQiqnDIAggwOuk5/Wk.' },
  { id: 'b0c2be32-df91-47a4-8898-90ab2f6df85b', email: 'justicekipkemoi2006@gmail.com', pwdHash: '$2a$10$dmCUfzc.ZvuZ61/PHpGd5.xmecpKQW/7ThQEP8caMxJgZfnzcpxo.' },
  { id: '42033b6d-38ef-4354-9253-968abcefe026', email: 'vintarus1@gmail.com', pwdHash: '$2a$10$ccwXmxgh5AEuvtHTTbNWTuol9MovWByqS5G2Yy72PuUn0v9GElbRm' },
  { id: 'cdfa9620-b1fa-4693-908f-fa17409f467c', email: 'jacobreed6232@gmail.com', pwdHash: '$2a$10$C6nPCPUz6.sjpjjWGjqiIeX6.IqGlUl7qNRjxC72jTTaJFnmQX6MK' },
  { id: '59427519-8043-4425-9e0b-019db51b1b2c', email: 'cnahashon51@gmail.com', pwdHash: '$2a$10$LSIh3EmNSqoJ0W2D.YBjaOsKvGEc7NPaENT8FDv0eEzpbRgvOHfX6' },
  { id: 'c7ba5c95-79ad-403f-a6e2-8bb1f6066b76', email: 'vintarus4@gmail.com', pwdHash: '$2a$10$y4yd0hY00noM82gGGyRRhus2iQocuvHH3PKSQG.sn2AFl6A89tXvu' },
  { id: '1c19d8b0-6127-4230-a07c-67786ad4ca76', email: 'kipngetichkenneth184@gmail.com', pwdHash: '$2a$10$RDn2OQnD0vW9MHABQCc3v.5j8egMgiT/Sk5arMV6IpDR5CAdnpCmm' },
  { id: '578da9f3-9fed-4f48-9f1a-8ea586ad62b5', email: 'collins20collo@gmail.com', pwdHash: '$2a$10$OsXp11LW80I1uxfckxjG.eoUT4ZGK/qpRwk6XwFrT8XRNUehXS61a' },
  { id: '8b2d784f-a221-49b4-a4c5-30ca3608e104', email: 'isabellajenkins348@gmail.com', pwdHash: '$2a$10$Vs.wxftTQGrWPGWdCJB77OoWf7P1/rFAgslZN3gxIkzR32/u6bfdm' },
  { id: '7c65fb78-552c-4479-b290-dbd08bb0fb81', email: 'matatasam.ai@gmail.com', pwdHash: '$2a$10$YuGswnEaFfPkiO787XoQXej2bq7f5EoZy5cRRBPqUwaE5VtLuMmoi' },
  { id: '69b9955c-0df6-46af-9b4b-8a909afcf4dc', email: 'kenn19599@gmail.com', pwdHash: '$2a$10$ghXACGbCX0zO5Aahh5wCqOt0xyZdPNFjloOYpb6vfh9EUsQbt4PWK' },
  { id: '33fa0532-4007-4e94-a7ca-4ebfad585bf5', email: 'timookorir@gmail.com', pwdHash: '$2a$10$8OSY.wmRN/IMs6wLCafo/O8PMNyujkOUk9IleqZNlKwp7op7urFdq' },
  { id: '43ff12a8-2d31-409b-9fff-3edb2f7a7af9', email: 'tkoech779@gmail.com', pwdHash: '$2a$10$7gFMv9dTqlOIrhCNMeGGxuhMs3gskvR4ggBFI0fCzHpviSRKcalQ6' }
];

async function run() {
  console.log(`Creating ${USERS.length} users through GoTrue Admin API...`);
  for (const u of USERS) {
    try {
      const res = await fetch(url + '/auth/v1/admin/users', {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: u.id,
          email: u.email,
          password: 'TempPassword123!',
          email_confirm: true,
          user_metadata: { email_verified: true, sub: u.id }
        })
      });
      const data = await res.json();
      if (res.status === 200) {
        console.log(`[OK] Created: ${u.email} (${u.id})`);
      } else {
        console.log(`[WARN] ${u.email}: ${res.status}`, data);
      }
    } catch (e) {
      console.error(`[ERR] ${u.email}:`, e.message);
    }
  }
}

run();
