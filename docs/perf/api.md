# Заявки за родословието: измерване (M04)

Генерирано от `pnpm perf:queries` (`scripts/perf-queries.ts`) на 2026-10-18. Не се редактира на ръка: при промяна на заявките, изгледите или индексите командата се пуска отново и резултатът се записва (план §6.3).

## Среда

- **Сървър:** PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit
- **PostGIS:** 3.4.2
- **Данни:** собствена временна база, изтрита след измерването. 55,030 измислени личности (`demo-perf-…`, 53,353 публични) в 9 поколения и 5 линии; 99,864 връзки учител–ученик (87,610 видими през `v_public_edge`), всяка с един период на обучение. Ключовете са `uuid` (UUIDv7 от приложението).
- **Достъп:** като в услугата: ролята `app_public_ro`, изгледите `v_public_person` и `v_public_edge`, транзакция `READ ONLY`, `REPEATABLE READ`, първа заявка `SET LOCAL statement_timeout = '2s'`; същите функции от `src/server/services/lineage-graph.ts`.
- **Повторения:** една загряваща и 7 измерени заявки за всеки случай (времето е цялата транзакция, видяно от Node). Плановете са от `EXPLAIN (ANALYZE, BUFFERS)` в отделна транзакция след тях, затова буферите са главно попадения в кеша.

## Резултати

| Процедура | Вход | Възли | Ребра | Таван (500) | мин. | медиана | макс. |
|---|---|---|---|---|---|---|---|
| `lineage.ego` | хъбът с най-много ученици; up 16, down 2, fanout 50 | 87 | 105 | не | 55.5 ms | 62.0 ms | 82.5 ms |
| `lineage.ego` | хъбът; up 16, down 4, fanout 100 (горните граници) | 137 | 155 | не | 55.3 ms | 58.4 ms | 65.2 ms |
| `lineage.ego` | личност от последното поколение с 3+ учители; up 16, down 2, fanout 50 | 116 | 192 | не | 50.3 ms | 55.1 ms | 62.9 ms |
| `lineage.ancestors` | същата личност (всички предци) | 116 | 192 | не | 49.7 ms | 55.5 ms | 76.0 ms |
| `lineage.subtree` | коренът на линия 1; depth 3 | 500 | 734 | достигнат | 125.7 ms | 129.7 ms | 136.0 ms |
| `lineage.subtree` | коренът на линия 1; depth 6 (горната граница) | 500 | 734 | достигнат | 116.3 ms | 121.1 ms | 128.5 ms |
| `lineage.paths` | личността от последното поколение; limit 50 | 91 | 130 | не | 59.8 ms | 64.6 ms | 91.6 ms |

## Планове

### `lineage.ego` — хъбът с най-много ученици; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 87 | 13.3 ms | 6.87 ms | 13072 / 0 | Seq Scan lineage ×45; Index Scan person_pkey ×2029; Index Only Scan person_name_one_primary_key ×1078; Index Scan teaching_relationship_student_cover_idx ×44; Index Scan teaching_relationship_teacher_cover_idx ×51; Index Scan person_name_one_primary_key ×926 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 87 | 0.67 ms | 0.36 ms | 726 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×87; Index Scan person_name_person_id_idx ×87 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 105 | 2.57 ms | 4.68 ms | 2618 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×315; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×315; Index Scan training_period_relationship_id_idx ×105 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 87 | 14.2 ms | 2.71 ms | 14050 / 0 | Seq Scan lineage ×88; Index Scan person_pkey ×2064; Index Only Scan person_name_one_primary_key ×2020; Index Scan teaching_relationship_student_cover_idx ×87; Index Scan teaching_relationship_teacher_cover_idx ×87 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 147 | 1.55 ms | 3.37 ms | 2062 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×295; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×294 |
| 6 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.16 ms | 2.98 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — хъбът; up 16, down 4, fanout 100 (горните граници)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 137 | 10.5 ms | 3.19 ms | 13522 / 0 | Seq Scan lineage ×45; Index Scan person_pkey ×2079; Index Only Scan person_name_one_primary_key ×1128; Index Scan teaching_relationship_student_cover_idx ×44; Index Scan teaching_relationship_teacher_cover_idx ×101; Index Scan person_name_one_primary_key ×926 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 137 | 1.06 ms | 0.32 ms | 1144 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×137; Index Scan person_name_person_id_idx ×137 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 155 | 3.62 ms | 3.61 ms | 3903 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×465; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×465; Index Scan training_period_relationship_id_idx ×155 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 137 | 14.8 ms | 2.62 ms | 15604 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×2257; Index Only Scan person_name_one_primary_key ×2211; Index Scan teaching_relationship_student_cover_idx ×137; Index Scan teaching_relationship_teacher_cover_idx ×137 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 238 | 2.45 ms | 3.05 ms | 3345 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×479; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×476 |
| 6 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.18 ms | 2.90 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — личност от последното поколение с 3+ учители; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 2.70 ms | 4.16 ms | 2783 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×352; Index Only Scan person_name_one_primary_key ×349; Index Scan teaching_relationship_student_cover_idx ×138; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_name_one_primary_key ×0 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.69 ms | 0.27 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 6.81 ms | 5.33 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 36.1 ms | 2.70 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 192 | 3.09 ms | 5.62 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.ancestors` — същата личност (всички предци)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 2.40 ms | 1.46 ms | 2774 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×351; Index Only Scan person_name_one_primary_key ×348; Index Scan teaching_relationship_student_cover_idx ×138 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.69 ms | 0.26 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 4.25 ms | 3.39 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 25.9 ms | 2.74 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.72 ms | 2.98 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.subtree` — коренът на линия 1; depth 3

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.37 ms | 2.84 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 1.55 ms | 2.62 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 28.0 ms | 4.09 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 17.8 ms | 0.78 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 17.4 ms | 4.08 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 38.2 ms | 2.60 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 16.5 ms | 3.18 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.subtree` — коренът на линия 1; depth 6 (горната граница)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.31 ms | 2.36 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 1.57 ms | 2.95 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 19.4 ms | 2.97 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 16.9 ms | 0.68 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 13.9 ms | 4.02 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 40.2 ms | 2.67 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 20.1 ms | 3.32 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.paths` — личността от последното поколение; limit 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH p …` | 109 | 7.96 ms | 3.19 ms | 9997 / 0 | Seq Scan lineage ×625; Index Scan person_pkey ×1222; Index Only Scan person_name_one_primary_key ×1140; Index Scan teaching_relationship_student_cover_idx ×625 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.66 ms | 0.29 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.75 ms | 3.13 ms | 2711 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 91 | 0.76 ms | 0.24 ms | 760 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×91; Index Scan person_name_person_id_idx ×91 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 138 | 3.00 ms | 3.16 ms | 3354 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×414; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×414; Index Scan training_period_relationship_id_idx ×138 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 91 | 21.8 ms | 2.50 ms | 22741 / 0 | Seq Scan lineage ×92; Index Scan person_pkey ×3383; Index Only Scan person_name_one_primary_key ×3275; Index Scan teaching_relationship_student_cover_idx ×91; Index Scan teaching_relationship_teacher_cover_idx ×91 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 151 | 1.34 ms | 3.15 ms | 2124 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×305; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×302 |

## Изводи

- Всички 7 случая завършват под тавана от 2 s на `statement_timeout`; най-бавната измерена транзакция е 136.0 ms.
- Последователно четене на големи таблици: `teaching_relationship`, `person`, `person_name`, в заявки от най-много 28.0 ms. Това са хеш съединения, които планировчикът избира за няколкостотин реда наведнъж, и `LIMIT 1` при линиите; всяка такава заявка е под 50 ms, затова не е нужна нова миграция с индекси. При десеткратно по-голяма база измерването се повтаря.
- Целта на план §4.11 (p95 < 300 ms за API на изследователя) се проверява с `pnpm perf:api` в M13 през HTTP; тук се мерят само заявките към базата.
