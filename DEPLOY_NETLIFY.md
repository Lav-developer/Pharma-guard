# Deploy to Netlify in 3 Steps

## **Step 1: Push to GitHub**
1. Create a GitHub account (free): https://github.com/signup
2. Create a new repository (name: `pharmgpt-vcf-app`)
3. Push your code:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pharmgpt-vcf-app.git
git push -u origin main
```

## **Step 2: Connect to Netlify**
1. Go to https://app.netlify.com/signup (sign up with GitHub)
2. Click **Add new site** → **Import an existing project**
3. Select your GitHub repo (`pharmgpt-vcf-app`)
4. **Build command**: `npm install`
5. **Publish directory**: `public`
6. Click **Deploy site**

## **Step 3: Set Environment Variables (Optional)**
If you want Gemini API explanations:
1. In Netlify dashboard → **Site settings** → **Build & deploy** → **Environment**
2. Add: `GEMINI_API_KEY` = your Gemini API key
3. Redeploy (click **Deploys** → **Trigger deploy**)

**Done!** Your app will be live at `https://YOUR_SITE_NAME.netlify.app`

---

**Don't have a GitHub account?** I can also guide you through Vercel (even simpler).
