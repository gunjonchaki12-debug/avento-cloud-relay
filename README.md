# 🌐 AVENTO Worldwide Cloud Relay & Progressive Web App (PWA)

এই প্যাকেজটি দিয়ে আপনি বিশ্বের যেকোনো প্রান্ত (যেমন: কানাডা) থেকে ইন্টারনেটের মাধ্যমে বাংলাদেশে থাকা আপনার **Avento AI Desktop Robot** লাইভ দেখতে ও নিয়ন্ত্রণ করতে পারবেন। রুমে কোনো কম্পিউটার চালু রাখতে হবে না!

---

## 🏗️ আর্কিটেকচার (How It Works)

```
[ ESP32-S3 Robot (Bangladesh) ]
          │ (Outbound WSS / Port 443)
          ▼
[ Free Cloud Relay on Render / Railway / VPS ]
          ▲ (HTTPS & WSS)
          │
[ Your Phone / Laptop PWA (Canada) ]
```

- **NAT/CGNAT বাইপাস:** রোবটটি নিজে থেকেই ক্লাউড সার্ভারে আউটবাউন্ড কানেকশন পাঠায়। ফলে রাউটারে কোনো পোর্ট ফরোয়ার্ডিং করতে হয় না।
- **স্বয়ংক্রিয় SSL/HTTPS:** ক্লাউড প্রোভাইডার ফ্রি SSL দেয়, যা মোবাইল ফোনে PWA অ্যাপ ইনস্টল করার প্রধান শর্ত।
- **সাব-১০০ms ল্যাটেন্সি:** বাইনারি ওয়েব-সকেটের মাধ্যমে সরাসরি ২০-৩০ FPS ভিডিও ফ্রেম ও কন্ট্রোল সিগন্যাল আদান-প্রদান হয়।

---

## 🚀 ফ্রি ক্লাউড সার্ভার ডিপ্লয়মেন্ট (Render.com - ৫ মিনিটে)

1. [GitHub](https://github.com)-এ একটি ফ্রি রিপোজিটরি তৈরি করে এই `cloud_relay` ফোল্ডারটি পুশ করুন (অথবা সম্পূর্ণ antiG2 ফোল্ডার)।
2. [Render.com](https://render.com)-এ ফ্রি অ্যাকাউন্ট খুলুন।
3. **New +** বাটনে ক্লিক করে **Web Service** সিলেক্ট করুন।
4. আপনার গিটহাব রিপোজিটরি সিলেক্ট করুন।
5. সেটিংস দিন:
   - **Root Directory:** `cloud_relay`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
6. ডিপ্লয় শেষে Render আপনাকে একটি ফ্রি HTTPS লিংক দেবে, যেমন:
   `https://my-avento-robot.onrender.com`

---

## 🤖 রোবটের ফার্মওয়্যার কনফিগারেশন

Render থেকে প্রাপ্ত ডোমেইনটি `smart_robot_firmware/AventoConfig.h`-এ বসিয়ে দিন:

```cpp
// ---------------------------------------------------------
// 4. WORLDWIDE CLOUD RELAY SETTINGS
// ---------------------------------------------------------
#define ENABLE_CLOUD_RELAY    true   // true করে দিন
#define CLOUD_RELAY_HOST      "my-avento-robot.onrender.com" // আপনার Render ডোমেইন
#define CLOUD_RELAY_PORT      443
#define CLOUD_RELAY_SSL       true
#define CLOUD_RELAY_PATH      "/ws/robot"
#define CLOUD_RELAY_TOKEN     "avento_secret_2026"
#define CLOUD_RELAY_FPS       20
```

এরপর ফার্মওয়্যারটি রোবটে আপলোড করে দিন। রোবটটি চালু হওয়ামাত্র স্বয়ংক্রিয়ভাবে ক্লাউডের সাথে যুক্ত হয়ে যাবে।

---

## 📱 কানাডা বা যেকোনো দেশ থেকে PWA অ্যাপ হিসেবে ব্যবহারের নিয়ম

1. আপনার মোবাইল (Android/iPhone) বা ল্যাপটপের ব্রাউজারে Render-এর দেওয়া লিংকটি ওপেন করুন:
   `https://my-avento-robot.onrender.com`
2. **Android / PC:**
   - ড্যাশবোর্ডের উপরে সরাসরি **"Install App"** বাটন ভেসে উঠবে।
   - ক্লিক করলেই আপনার ফোনে বা ডেস্কটপে **"Avento Robot"** অ্যাপ ইনস্টল হয়ে যাবে।
3. **iPhone (iOS Safari):**
   - সাফারি ব্রাউজারের নিচে **Share** বাটনে চাপ দিন।
   - **"Add to Home Screen"** সিলেক্ট করুন।
4. অ্যাপ আইকনে ক্লিক করলেই ব্রাউজারের অ্যাড্রেস বার ছাড়া একদম নেটিভ অ্যাপের মতো ফুল-স্ক্রিনে সাইবারপাঙ্ক কন্ট্রোল সেন্টার চালু হয়ে যাবে!
