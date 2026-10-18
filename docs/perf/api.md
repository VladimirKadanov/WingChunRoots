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
| `lineage.ego` | хъбът с най-много ученици; up 16, down 2, fanout 50 | 87 | 105 | не | 52.7 ms | 63.3 ms | 97.8 ms |
| `lineage.ego` | хъбът; up 16, down 4, fanout 100 (горните граници) | 137 | 155 | не | 60.2 ms | 63.4 ms | 75.6 ms |
| `lineage.ego` | коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100 | 500 | 734 | достигнат | 119.7 ms | 131.9 ms | 172.2 ms |
| `lineage.ego` | личност от последното поколение с 3+ учители; up 16, down 2, fanout 50 | 116 | 192 | не | 47.7 ms | 51.7 ms | 79.9 ms |
| `lineage.ancestors` | същата личност (всички предци) | 116 | 192 | не | 45.4 ms | 48.9 ms | 75.0 ms |
| `lineage.subtree` | коренът на линия 1; depth 3 | 500 | 734 | достигнат | 128.1 ms | 155.7 ms | 203.8 ms |
| `lineage.subtree` | коренът на линия 1; depth 6 (горната граница) | 500 | 734 | достигнат | 127.7 ms | 131.7 ms | 150.1 ms |
| `lineage.paths` | личността от последното поколение; limit 50 | 91 | 130 | не | 59.1 ms | 60.7 ms | 64.1 ms |

## Планове

### `lineage.ego` — хъбът с най-много ученици; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 37 | 0.87 ms | 1.60 ms | 818 / 0 | Seq Scan lineage ×44; Index Scan person_pkey ×101; Index Only Scan person_name_one_primary_key ×101; Index Scan teaching_relationship_student_cover_idx ×44 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 50 | 9.63 ms | 1.77 ms | 11804 / 0 | Index Scan person_pkey ×1878; Index Only Scan person_name_one_primary_key ×927; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×926 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.55 ms | 1.67 ms | 450 / 0 | Index Scan person_pkey ×50; Index Only Scan person_name_one_primary_key ×50; Index Scan teaching_relationship_teacher_cover_idx ×50; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 87 | 0.72 ms | 0.26 ms | 726 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×87; Index Scan person_name_person_id_idx ×87 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 105 | 2.54 ms | 3.60 ms | 2618 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×315; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×315; Index Scan training_period_relationship_id_idx ×105 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 87 | 14.2 ms | 2.52 ms | 14050 / 0 | Seq Scan lineage ×88; Index Scan person_pkey ×2064; Index Only Scan person_name_one_primary_key ×2020; Index Scan teaching_relationship_student_cover_idx ×87; Index Scan teaching_relationship_teacher_cover_idx ×87 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 147 | 1.60 ms | 3.70 ms | 2062 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×295; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×294 |
| 8 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.22 ms | 3.41 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — хъбът; up 16, down 4, fanout 100 (горните граници)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 37 | 1.15 ms | 2.35 ms | 818 / 0 | Seq Scan lineage ×44; Index Scan person_pkey ×101; Index Only Scan person_name_one_primary_key ×101; Index Scan teaching_relationship_student_cover_idx ×44 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 100 | 9.24 ms | 1.84 ms | 11804 / 0 | Index Scan person_pkey ×1878; Index Only Scan person_name_one_primary_key ×927; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×926 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.81 ms | 1.64 ms | 900 / 0 | Index Scan person_pkey ×100; Index Only Scan person_name_one_primary_key ×100; Index Scan teaching_relationship_teacher_cover_idx ×100; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 137 | 0.96 ms | 0.33 ms | 1144 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×137; Index Scan person_name_person_id_idx ×137 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 155 | 3.76 ms | 3.05 ms | 3903 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×465; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×465; Index Scan training_period_relationship_id_idx ×155 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 137 | 17.2 ms | 2.93 ms | 15604 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×2257; Index Only Scan person_name_one_primary_key ×2211; Index Scan teaching_relationship_student_cover_idx ×137; Index Scan teaching_relationship_teacher_cover_idx ×137 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 238 | 2.94 ms | 3.61 ms | 3345 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×479; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×476 |
| 8 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.24 ms | 3.82 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 1 | 0.11 ms | 1.42 ms | 10 / 0 | Seq Scan lineage ×1; Index Scan person_pkey ×1; Index Only Scan person_name_one_primary_key ×1; Index Scan teaching_relationship_student_cover_idx ×1 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 28 | 0.34 ms | 1.34 ms | 351 / 0 | Index Scan person_pkey ×57; Index Only Scan person_name_one_primary_key ×29; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×28 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 162 | 1.93 ms | 1.36 ms | 2669 / 0 | Index Scan person_pkey ×405; Index Only Scan person_name_one_primary_key ×214; Index Scan teaching_relationship_teacher_cover_idx ×28; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×186 |
| 4 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 310 | 13.2 ms | 1.62 ms | 18626 / 0 | Index Scan person_pkey ×2832; Index Only Scan person_name_one_primary_key ×1479; Index Scan teaching_relationship_teacher_cover_idx ×162; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×1317 |
| 5 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 23.7 ms | 0.89 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 6 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 15.8 ms | 9.09 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 7 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 41.0 ms | 3.36 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 8 | `SELECT student_person_id::text AS student_id, id…` | 957 | 19.3 ms | 3.37 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.ego` — личност от последното поколение с 3+ учители; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 2.85 ms | 1.47 ms | 2774 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×351; Index Only Scan person_name_one_primary_key ×348; Index Scan teaching_relationship_student_cover_idx ×138 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.16 ms | 1.54 ms | 9 / 0 | Index Scan person_pkey ×1; Index Only Scan person_name_one_primary_key ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 3 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.78 ms | 0.29 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 4 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 4.17 ms | 3.13 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 5 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 22.8 ms | 2.75 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 6 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.77 ms | 3.81 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.ancestors` — същата личност (всички предци)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 4.16 ms | 2.46 ms | 2774 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×351; Index Only Scan person_name_one_primary_key ×348; Index Scan teaching_relationship_student_cover_idx ×138 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.69 ms | 0.30 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 3.90 ms | 3.53 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 22.3 ms | 2.66 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.74 ms | 3.09 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.subtree` — коренът на линия 1; depth 3

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.33 ms | 3.09 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 1.50 ms | 2.54 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 18.5 ms | 3.00 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 13.1 ms | 0.51 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 18.3 ms | 4.30 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 52.4 ms | 2.65 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 32.2 ms | 5.49 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.subtree` — коренът на линия 1; depth 6 (горната граница)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.27 ms | 2.47 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 1.51 ms | 2.79 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 17.9 ms | 3.14 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 11.8 ms | 0.76 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 13.8 ms | 4.64 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 40.3 ms | 2.69 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 17.0 ms | 3.38 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.paths` — личността от последното поколение; limit 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH p …` | 109 | 7.84 ms | 2.96 ms | 9997 / 0 | Seq Scan lineage ×625; Index Scan person_pkey ×1222; Index Only Scan person_name_one_primary_key ×1140; Index Scan teaching_relationship_student_cover_idx ×625 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.67 ms | 0.25 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.64 ms | 2.85 ms | 2711 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 91 | 0.53 ms | 0.28 ms | 760 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×91; Index Scan person_name_person_id_idx ×91 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 138 | 2.77 ms | 3.17 ms | 3354 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×414; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×414; Index Scan training_period_relationship_id_idx ×138 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 91 | 21.9 ms | 2.69 ms | 22741 / 0 | Seq Scan lineage ×92; Index Scan person_pkey ×3383; Index Only Scan person_name_one_primary_key ×3275; Index Scan teaching_relationship_student_cover_idx ×91; Index Scan teaching_relationship_teacher_cover_idx ×91 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 151 | 1.35 ms | 3.15 ms | 2124 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×305; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×302 |

## Изводи

- Всички 8 случая завършват под тавана от 2 s на `statement_timeout`; най-бавната измерена транзакция е 203.8 ms.
- Последователно четене на големи таблици: `teaching_relationship`, `person_name`, `person`, в заявки от най-много 32.2 ms. Това са хеш съединения, които планировчикът избира за няколкостотин реда наведнъж, и `LIMIT 1` при линиите; всяка такава заявка е под 50 ms, затова не е нужна нова миграция с индекси. При десеткратно по-голяма база измерването се повтаря.
- Целта на план §4.11 (p95 < 300 ms за API на изследователя) се проверява с `pnpm perf:api` в M13 през HTTP; тук се мерят само заявките към базата.
