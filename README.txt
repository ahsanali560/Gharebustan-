GHARABUSTAN - doston ke saath online custom room game
=====================================================

PEHLI BAAR (sirf ek baar)
1. Node.js install karo (LTS version): https://nodejs.org
2. Is folder mein "start.bat" par double click karo.
   Black window mein "GHARABUSTAN server chal gaya" likha aayega. Is window ko band mat karna.
3. Browser mein kholo:  http://localhost:3000
   (Pehli dafa server 3D engine download karta hai, is ke liye PC par internet chahiye.)

KHELNA
- "Room banao" dabao. 4 harf ka code milega.
- Dost apne phone/PC ke browser mein game ka link kholein, naam likhein,
  apna character chunein, code daalein aur "Room mein jao" dabayein.
- Host (jis ne room banaya) "Match shuru karo" dabaye.
- Sab parachute se girte hain, hathiyar uthao (upar se guzar jao to khud uth jate hain),
  zone se bahar mat raho, aakhri bachne wala jeet-ta hai.

CONTROLS (v4)
PC:    WASD chalo | mouse dekho (pehle game par click karo) | left click goli
       Space jump | Shift daurna | 1/2/3 ya Q ya mouse wheel = gun badlo
       F = zameen ki gun se badlo | H = medkit | G = gloo wall | B = emote | V = mukka
Phone (Free Fire jaisi jagah, sab buttons par icon):
       neeche left stick | RUN (daudta insan): ek baar dabao to khud daurta hai; stick pakarte hi RUN band ho jata hai, phir RUN dabao to dobara daurta hai
       BADLO (gol teer wala) = agli gun | WALL (deewar) aur MEDKIT (cross wala dabba) left kinare | smiley = EMOTE
       upar right mein slots 1/2/3 (guns) aur 4 (khali hath, mukka) | FIRE neeche right aur doosra FIRE left mein: dabao aur usi ungli ko ghumao = drag shot
       JUMP (right) | baithna (crouch) | letna (prone) | gear = CONTROL SETTINGS
Control settings: gear dabao, phir kisi button ko pakar kar kahin bhi rakho, Size slider se bara/chhota karo, Opacity slider se dhundla/saaf karo ("Sab buttons" tick karo to sab par ek saath),
       Aim speed se ghumne ki raftar badlo, Save dabao. Reset se pehli jagah wapas.
PC ke extra keys: C = baithna, Z = letna, 4 ya V = khali hath (mukka). Emotes ab 12 hain.
HP 200 hai. Medkit +100 HP deta hai.
Aim lock: dushman sar se paon tak kahin bhi crosshair par aaye to ring laal ho jati hai. FIRE dabate hi camera uske jism par tik jata hai (hilta nahi). FIRE button ko seedha upar drag karo to aim paon se seene se sar tak chadhta hai (headshot), neeche drag karo to wapas. Side drag lock mein ignore hota hai.
Ghar ke darwaze se andar ja sakte ho. Camera ghumane se character nahi ghoomta, sirf chalne ya firing par ghoomta hai.

DOSTON KO KAISE JORNA (teen tareeke)

A) Same WiFi / hotspot (sab se aasan)
   Agar phone se link na khule: pehle "allow_firewall.bat" par double click karo, "Yes" dabao, phir
   start.bat dobara chalao. Phone WiFi par ho (mobile data band), PC ke WiFi par hi.
   Server wali window mein "Same WiFi walay dost: http://192.168.x.x:3000" likha hota hai.
   Doston ke phone isi WiFi par hon aur ye link kholein.

B) Internet par kisi bhi jagah se (Cloudflare tunnel, free, account nahi chahiye)
   1. https://github.com/cloudflare/cloudflared/releases se "cloudflared-windows-amd64.exe" download karo.
   2. Naya command window kholo (is folder mein) aur chalao:
        cloudflared-windows-amd64.exe tunnel --url http://localhost:3000
   3. Window mein "https://xxxx.trycloudflare.com" jaisa link aayega. Ye link doston ko bhejo.
   PC aur server chalta rehna chahiye jab tak match hai.

C) Hamesha online (Render.com free hosting)
   Is folder ko GitHub par daalo, Render.com par "New Web Service" banao,
   Build command: npm install   |   Start command: node server.js
   Free plan thori der idle rehne par so jata hai, pehla load slow ho sakta hai.

NOTES
- Map Ahsan ke area ke satellite screenshot se hath se banaya gaya hai, bilkul asli naqsha nahi.
- Character ke chehre teeno dosto ki photo se bane hain. Ye photos sirf apne doston ke saath share karo.
- Max 12 players per room.
- Agar 3D engine na chale: https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js se file
  download karke "public\vendor\three.min.js" naam se rakh do.

==== V12: NAYA LOBBY / MENU (purane Free Fire jaisa structure) ====
Home screen: upar naam+level+XP, coins aur gems. Beech mein tumhara character stage par
(ungli se ghumao). Room mein dost tumhare saath khade dikhte hain.
Left menu: STORE, LUCK ROYALE, CHARACTER, VAULT, PET, COLLECTION.
Neeche bara "ROOM BANAO" button (room banne par host ke liye START).
- STORE: libas, topi/chashma, pet kharido (pehle preview, phir BUY/EQUIP). REDEEM tab: codes
  GHAREEB, AHSAN, JASIM, HASSAN.
- LUCK ROYALE: roz 1 free spin, warna 20 gems. Coins/gems/libas/topi inaam.
- CHARACTER: 3 characters + skill. Hassan: +6% speed, Ahsan: 30 vest se start, Jasim: +12% headshot damage.
- VAULT: jo tumhare paas hai wo equip karo. PET: lobby pet. COLLECTION: stats aur emotes.
- Roz pehli baar kholne par +300 coins +5 gems. Match ke baad kills/damage/jeet par coins, gems, XP.
- Sab save tumhare apne phone/PC mein hota hai (localStorage).
Agar purana menu dikhe: browser cache clear karo ya /?v=12 kholo. Menu par "V12" likha hoga.

==== V13: MODES, PROFILE, BOTS ====
Neeche START ke upar MODE button hai (tap karo, 3 cards khulte hain):
- BATTLE ROYALE: tum + 25 bots. START dabate hi match shuru.
- CLASH SQUAD: 4 vs 4, teammate bots tumhare saath, 3 round jeeto, friendly fire nahi.
- CUSTOM ROOM: doston ke liye. START ("ROOMS") dabao -> room list, ROOM ID + JAO, QUICK JOIN, CREATE.
  CREATE form: room naam, password, mode (BR / CS), bots on/off, bots kitne, list mein dikhao/private.
  Room banne ke baad code dost ko bhejo ya woh list se join karein.
Upar left profile badge par tap karo: level, XP, rank, record, naam badalna (naam yahin se badlega).
Bots khud loot karte hain, zone mein bhagte hain aur ladte hain. Sab server par chalte hain.
Purana menu dikhe to cache clear karo ya /?v=13 kholo. Menu par "V13" likha hoga.
