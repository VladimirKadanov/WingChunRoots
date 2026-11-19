# ADR 0050: Видеа в профила като вградени връзки към YouTube и Vimeo

| | |
|---|---|
| Статус | Прието (19.11.2026) |
| Контекст | Планът „Premium student upgrade plan“ (Claude Doc, 18.11.2026), функция „Video embeds“, одобрен от собственика: само връзки към YouTube и Vimeo, без качване; плейърът се зарежда при натискане; персоналът премахва с причина. На 19.11.2026 собственикът каза „go on, dont wait for my approval, lets pack this up“. Спецификация §3.1; план §5.6, §6.5 |
| Свързани | [ADR 0044](0044-premium-student.md) (редът „Videos“ беше скрит), [ADR 0047](0047-featured-profile.md) (връзките на профила), [`docs/entitlements.md`](../entitlements.md) (матрицата `2026-11-19.4`) |

## Решение

Редът `videos` („Videos“) в матрицата вече е `now`, `enforced: true` и не е скрит. Квотите са тези от спецификацията (DEFAULT D07): Free Student и Free Sifu 0, Premium Student 2, Professional Sifu 20; за Federation „без ограничение“ означава горната граница на приложението, 20 (`PROFILE_VIDEOS_MAX`).

- **Само връзки, никога качване.** Таблица `person_video` (позиция 0–19, `provider` `youtube` или `vimeo`, `video_id` с проверен формат, заглавие до 100 знака). Пази се само доставчикът и идентификаторът: адресът, който членът е въвел, никога не се вгражда. `parseVideoUrl` в `src/server/services/videos.ts` приема `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/embed/` и `vimeo.com/<число>`; всичко друго е грешка в полето.
- **Плейърът се зарежда само при натискане.** Публичният профил показва заглавие, връзка **Play** (`?play=<id>#video-<id>`, работи без JavaScript) и **Open on YouTube/Vimeo** (`rel="nofollow ugc noopener noreferrer"`, в същия раздел). Едва след **Play** се появява `iframe` към `www.youtube-nocookie.com` или `player.vimeo.com` с `dnt=1`, със `sandbox="allow-scripts allow-same-origin allow-presentation"` и без препращач. Без натискане към доставчика не отива нито една заявка.
- **Процедури.** `profile.videos` (собствените видеа и лимитът), `profile.setVideos` (подменя всички наведнъж и в ред; лимит 0 дава `ENTITLEMENT_REQUIRED`, над квотата `BAD_REQUEST`; одит `person.videos`), `profile.removeVideo` (персонал с потвърден втори фактор, причина, одит `person.video_remove`, известие `content.removed` с „A video on your profile“), `people.videos` (публичният отговор, еднакъв за всички, кеширан за минути и маркиран с `personTag`; NOT_FOUND за човек, който не е публичен).
- На по-нисък план видеата се пазят, а профилът показва само първите толкова, колкото позволява планът (DEFAULT D08). При изтриване на акаунта видеата се изтриват.

## Алтернативи

- Качване на видео: отхвърлено (цена на съхранение и преглед на съдържанието).
- Вграждане при зареждане на страницата: отхвърлено (заявки към трета страна без съгласие и по-бавна страница).
- Свободен адрес за вграждане: отхвърлено (само двата доставчика, по идентификатор).

## Последици

- Миграция `*_premium_video_embeds`; `docs/api/openapi.json` има четирите процедури; матрицата за права има редовете им и двата Server Action-а.
- `/plans` и подканата за надграждане вече показват реда „Videos“.
- Интеграционни тестове: `videos.int.test.ts`; E2E `e2e/premium-video-embeds.spec.ts` (в изключителното пускане, защото пише публична страница).
