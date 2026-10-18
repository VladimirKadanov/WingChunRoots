---
version: 2026-10-18-draft
title: Privacy notice
---

> **Draft — pending legal review.** This is a working draft for the WingChunRoots pilot. A lawyer has not reviewed it yet, and it will change before the pilot opens to the public.

## 1. Who is responsible

The WingChunRoots pilot team. The full contact details of the controller will be published here before the pilot opens to the public.

## 2. What we collect

- **Account:** your e-mail address; your password, stored only as a salted hash; your role; whether two-factor authentication is on, with its secret and backup codes stored encrypted.
- **Sessions:** a session token in a cookie, its expiry date, your browser's user-agent text and the `ip_hmac` value described below.
- **Profile:** your names (in Latin letters and, if you add them, in their original script, Jyutping and pinyin), your country, your city, the year you started training, and whether your profile is public.
- **Confirmations:** which confirmation you gave (age, terms, authenticity declaration, privacy notice, a public profile), for which version of the document, and when.

We do **not** ask for your birth date. The pilot is for adults only, and you confirm your age with a tick.

## 3. How we treat your IP address (ip_hmac)

We do not store your IP address. Where an address helps protect accounts (your sessions and the audit log of changes), we store `ip_hmac` instead: a keyed fingerprint of your IP address (HMAC-SHA-256 with a secret key that only the server knows). It shows that two events came from the same address, but the address cannot be read back from it. The key is replaced every year, after which older values can no longer be matched with new ones.

To limit repeated attempts, the server counts failed sign-ins per e-mail address (and, for a browser that has signed in to that address before, per browser) and remembers the sign-in codes it has just accepted. It stores only keyed fingerprints of the e-mail address, the browser and the code, never the address or the code itself, and deletes them after 15 minutes at most. Requests for confirmation and reset e-mails are counted per IP address in the server's memory for a minute, without writing the address anywhere, and the e-mails each account gets are counted per hour in the log of sent e-mail.

## 4. Why we use it

To run your account and keep it secure, to show the records you take part in to the people involved and to the reviewers, to make your profile public only when you choose so, and to keep a record of your confirmations. The legal basis of each use will be stated here after the legal review.

## 5. Who receives it

- **OpenFreeMap** draws the maps of the school finder. When you look at a map, your browser loads the map images directly from OpenFreeMap, which therefore sees your IP address and the part of the map you view. No account data is sent to it.
- **Hosting, e-mail and monitoring providers** will be listed here when they are chosen. During the local pilot there are none: the site runs on the pilot team's own machines, and e-mail goes to a local test mailbox.

We do not sell data, and we do not use advertising or tracking services.

## 6. Who can see your profile

Your profile starts private: only the people involved in a teaching link with you and the reviewers can see it. It becomes public only if you tick "Show my profile publicly". A claim between living people stays private to the people involved until it is confirmed. Exact school addresses are never shown publicly.

## 7. How long we keep it

Your account and profile, until you ask us to close the account. An account whose e-mail address was never confirmed is deleted, with its confirmations, 7 days after sign-up. The e-mail addresses in the log of sent e-mail, 90 days. Sessions, until they expire or you sign out. The audit log of changes is kept without names or e-mail addresses.

## 8. Your rights

You can ask to see, correct or delete your data, to receive a copy, or to object to a use of it. Write to the pilot team (section 1).

## 9. Cookies

- `wcr.session_token`: keeps you signed in. Necessary.
- `wcr.two_factor`: holds a sign-in for a few minutes while you enter your second factor. Necessary.
- `wcr.form`: when your browser sends a form without JavaScript, holds the form's answer (its messages and the values you typed, never a password or a code) for 2 minutes, so the page can show it. Necessary.
- `wcr.sign-in-email`: after you confirm your e-mail address, fills it into the sign-in form for 10 minutes. Sent only to the sign-in page. Necessary.
- `wcr.codes`: holds your new backup codes, encrypted, for 30 minutes while you save them. Sent only to the security page. Necessary.
- `wcr.known_device`: remembers that this browser has signed in to your account before (or set its new password), so that wrong passwords someone else types for your e-mail address never lock you out here. It holds a keyed fingerprint of the address and a random number, not the address itself, for 180 days. Necessary.
- `wcr.totp-setup`: holds the key of a two-factor setup you started, encrypted, for 30 minutes, so the security page can show it again after a reload or a trip to your authenticator app. Sent only to the security page. Necessary.
- `wcr-theme`: remembers the light or dark theme if you choose one.

There are no advertising or analytics cookies.
