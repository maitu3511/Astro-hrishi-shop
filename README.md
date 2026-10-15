# Astro With Hrishi

Production web application with Firebase Firestore, Firebase Authentication, and secure Razorpay payment processing.

## Architecture

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Framer Motion.
- **Backend**: Firebase Firestore, Firebase Auth, Express / Node.js secure server for Razorpay HMAC signature verification and order creation.
- **Tracking & Analytics**: Google Analytics 4 (GA4) and Meta Pixel with page tracking and e-commerce event telemetry.
- **Hosting & Deployment**: SPA deployment ready for Netlify and Google Cloud Run.

## Payment Flow & Security

- Razorpay payment orders are created securely server-side.
- Payment verification uses cryptographic HMAC SHA256 signatures server-side.
- Razorpay secret key is kept strictly in server environment variables and never exposed to the client.

