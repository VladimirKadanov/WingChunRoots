# Заявки за родословието: измерване (M04)

Генерирано от `pnpm perf:queries` (`scripts/perf-queries.ts`) на 2026-10-19. Не се редактира на ръка: при промяна на заявките, изгледите или индексите командата се пуска отново и резултатът се записва (план §6.3).

## Среда

- **Сървър:** PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit
- **PostGIS:** 3.4.2
- **Данни:** собствена временна база, изтрита след измерването. 55,030 измислени личности (`demo-perf-…`, 53,353 публични) в 9 поколения и 5 линии; 99,864 връзки учител–ученик (87,610 видими през `v_public_edge`), всяка с един период на обучение. Ключовете са `uuid` (UUIDv7 от приложението).
- **Достъп:** като в услугата: ролята `app_public_ro`, изгледите `v_public_person` и `v_public_edge`, транзакция `READ ONLY`, `REPEATABLE READ`, първа заявка `SET LOCAL statement_timeout = '2s'`; същите функции от `src/server/services/lineage-graph.ts`.
- **Повторения:** една загряваща и 7 измерени заявки за всеки случай (времето е цялата транзакция, видяно от Node). Плановете са от `EXPLAIN (ANALYZE, BUFFERS)` в отделна транзакция след тях, затова буферите са главно попадения в кеша.

## Резултати

При `people.get` „Възли“ е 1 (профилът), „Ребра“ е учители + ученици, а „Таван“ е таванът на броя на потомците (10,000). При `people.students` „Възли“ са учениците на страницата, а „Ребра“ са всички публични ученици на учителя.

| Процедура | Вход | Възли | Ребра | Таван (500) | мин. | медиана | макс. |
|---|---|---|---|---|---|---|---|
| `lineage.ego` | хъбът с най-много ученици; up 16, down 2, fanout 50 | 87 | 105 | не | 51.0 ms | 62.5 ms | 76.4 ms |
| `lineage.ego` | хъбът; up 16, down 4, fanout 100 (горните граници) | 137 | 155 | не | 59.1 ms | 70.2 ms | 85.7 ms |
| `lineage.ego` | коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100 | 500 | 734 | достигнат | 118.8 ms | 131.3 ms | 155.4 ms |
| `lineage.ego` | личност от последното поколение с 3+ учители; up 16, down 2, fanout 50 | 116 | 192 | не | 51.5 ms | 53.9 ms | 81.9 ms |
| `lineage.ancestors` | същата личност (всички предци) | 116 | 192 | не | 46.7 ms | 56.7 ms | 70.8 ms |
| `lineage.subtree` | коренът на линия 1; depth 3 | 500 | 734 | достигнат | 123.8 ms | 133.0 ms | 163.7 ms |
| `lineage.subtree` | коренът на линия 1; depth 6 (горната граница) | 500 | 734 | достигнат | 131.3 ms | 139.6 ms | 183.2 ms |
| `lineage.paths` | личността от последното поколение; limit 50 | 91 | 130 | не | 54.3 ms | 55.5 ms | 74.8 ms |
| `people.get` | коренът на линия 1 (броят на потомците до тавана) | 1 | 28 | достигнат | 95.4 ms | 104.2 ms | 125.5 ms |
| `people.get` | хъбът | 1 | 928 | не | 25.2 ms | 26.8 ms | 40.0 ms |
| `people.students` | хъбът (926 ученици); страница 1 по име | 50 | 926 | не | 47.9 ms | 48.8 ms | 58.7 ms |
| `people.students` | хъбът; последната страница (19) по име | 26 | 926 | не | 45.2 ms | 47.5 ms | 51.9 ms |
| `people.students` | хъбът; 12 по старшинство (профилът) | 12 | 926 | не | 47.2 ms | 50.9 ms | 79.7 ms |

## Планове

### `lineage.ego` — хъбът с най-много ученици; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 37 | 0.83 ms | 1.43 ms | 818 / 0 | Seq Scan lineage ×44; Index Scan person_pkey ×101; Index Only Scan person_name_one_primary_key ×101; Index Scan teaching_relationship_student_cover_idx ×44 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 50 | 9.13 ms | 1.81 ms | 11804 / 0 | Index Scan person_pkey ×1878; Index Only Scan person_name_one_primary_key ×927; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×926 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.52 ms | 1.52 ms | 450 / 0 | Index Scan person_pkey ×50; Index Only Scan person_name_one_primary_key ×50; Index Scan teaching_relationship_teacher_cover_idx ×50; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 87 | 0.60 ms | 0.26 ms | 726 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×87; Index Scan person_name_person_id_idx ×87 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 105 | 2.62 ms | 3.50 ms | 2618 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×315; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×315; Index Scan training_period_relationship_id_idx ×105 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 87 | 16.0 ms | 3.13 ms | 14050 / 0 | Seq Scan lineage ×88; Index Scan person_pkey ×2064; Index Only Scan person_name_one_primary_key ×2020; Index Scan teaching_relationship_student_cover_idx ×87; Index Scan teaching_relationship_teacher_cover_idx ×87 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 147 | 2.29 ms | 3.51 ms | 2062 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×295; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×294 |
| 8 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.24 ms | 3.31 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — хъбът; up 16, down 4, fanout 100 (горните граници)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 37 | 0.80 ms | 1.39 ms | 818 / 0 | Seq Scan lineage ×44; Index Scan person_pkey ×101; Index Only Scan person_name_one_primary_key ×101; Index Scan teaching_relationship_student_cover_idx ×44 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 100 | 8.85 ms | 1.62 ms | 11804 / 0 | Index Scan person_pkey ×1878; Index Only Scan person_name_one_primary_key ×927; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×926 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.79 ms | 1.47 ms | 900 / 0 | Index Scan person_pkey ×100; Index Only Scan person_name_one_primary_key ×100; Index Scan teaching_relationship_teacher_cover_idx ×100; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 137 | 0.79 ms | 0.24 ms | 1144 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×137; Index Scan person_name_person_id_idx ×137 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 155 | 3.37 ms | 3.05 ms | 3903 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×465; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×465; Index Scan training_period_relationship_id_idx ×155 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 137 | 14.4 ms | 2.48 ms | 15604 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×2257; Index Only Scan person_name_one_primary_key ×2211; Index Scan teaching_relationship_student_cover_idx ×137; Index Scan teaching_relationship_teacher_cover_idx ×137 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 238 | 2.40 ms | 3.03 ms | 3345 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×479; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×476 |
| 8 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.14 ms | 2.86 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `lineage.ego` — коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 1 | 0.11 ms | 1.60 ms | 10 / 0 | Seq Scan lineage ×1; Index Scan person_pkey ×1; Index Only Scan person_name_one_primary_key ×1; Index Scan teaching_relationship_student_cover_idx ×1 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 28 | 0.67 ms | 2.45 ms | 351 / 0 | Index Scan person_pkey ×57; Index Only Scan person_name_one_primary_key ×29; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×28 |
| 3 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 162 | 2.03 ms | 1.44 ms | 2669 / 0 | Index Scan person_pkey ×405; Index Only Scan person_name_one_primary_key ×214; Index Scan teaching_relationship_teacher_cover_idx ×28; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×186 |
| 4 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 310 | 24.6 ms | 1.87 ms | 18626 / 0 | Index Scan person_pkey ×2832; Index Only Scan person_name_one_primary_key ×1479; Index Scan teaching_relationship_teacher_cover_idx ×162; Seq Scan lineage ×1; Index Scan person_name_one_primary_key ×1317 |
| 5 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 23.5 ms | 0.84 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 6 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 26.2 ms | 7.34 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 7 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 41.9 ms | 2.80 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 8 | `SELECT student_person_id::text AS student_id, id…` | 957 | 19.5 ms | 3.73 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.ego` — личност от последното поколение с 3+ учители; up 16, down 2, fanout 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 4.64 ms | 2.94 ms | 2774 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×351; Index Only Scan person_name_one_primary_key ×348; Index Scan teaching_relationship_student_cover_idx ×138 |
| 2 | `SELECT c.student_id::text AS id FROM unnest($2::…` | 0 | 0.25 ms | 2.83 ms | 9 / 0 | Index Scan person_pkey ×1; Index Only Scan person_name_one_primary_key ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Seq Scan lineage ×0; Index Scan person_name_one_primary_key ×0 |
| 3 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 1.64 ms | 0.50 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 4 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 8.31 ms | 5.77 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 5 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 23.6 ms | 3.49 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 6 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.82 ms | 3.07 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.ancestors` — същата личност (всички предци)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 116 | 2.30 ms | 1.39 ms | 2774 / 0 | Seq Scan lineage ×138; Index Scan person_pkey ×351; Index Only Scan person_name_one_primary_key ×348; Index Scan teaching_relationship_student_cover_idx ×138 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.67 ms | 0.28 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT id::text AS id, teacher_person_id::text A…` | 192 | 3.97 ms | 2.98 ms | 4622 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×576; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×576; Index Scan training_period_relationship_id_idx ×192 |
| 4 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 116 | 22.6 ms | 2.65 ms | 24917 / 0 | Seq Scan lineage ×117; Index Scan person_pkey ×3684; Index Only Scan person_name_one_primary_key ×3568; Index Scan teaching_relationship_student_cover_idx ×116; Index Scan teaching_relationship_teacher_cover_idx ×116 |
| 5 | `SELECT student_person_id::text AS student_id, id…` | 192 | 1.82 ms | 3.28 ms | 2696 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×387; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×384 |

### `lineage.subtree` — коренът на линия 1; depth 3

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.27 ms | 2.75 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 2.40 ms | 5.03 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 32.7 ms | 5.56 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 22.7 ms | 0.81 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 13.4 ms | 3.89 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 65.2 ms | 3.97 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 28.9 ms | 4.19 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.subtree` — коренът на линия 1; depth 6 (горната граница)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 28 | 0.43 ms | 2.60 ms | 345 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×56; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×56 |
| 2 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 162 | 1.51 ms | 2.81 ms | 2432 / 0 | Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×368; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×358 |
| 3 | `SELECT c.student_id::text AS id FROM ( SELECT pe…` | 310 | 18.2 ms | 2.81 ms | 10086 / 0 | Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×1; Index Scan person_pkey ×1; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2486 |
| 4 | `SELECT id::text AS id, slug, life_status, stewar…` | 500 | 12.7 ms | 0.54 ms | 3373 / 0 | Seq Scan person_name ×1; Index Scan person_pkey ×1; Index Scan person_name_person_id_idx ×500 |
| 5 | `SELECT id::text AS id, teacher_person_id::text A…` | 734 | 13.3 ms | 4.01 ms | 17702 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×2202; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×2202; Index Scan training_period_relationship_id_idx ×734 |
| 6 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 500 | 44.7 ms | 2.46 ms | 45636 / 0 | Seq Scan lineage ×501; Index Scan person_pkey ×6294; Index Only Scan person_name_one_primary_key ×6157; Index Scan teaching_relationship_student_cover_idx ×500; Index Scan teaching_relationship_teacher_cover_idx ×500 |
| 7 | `SELECT student_person_id::text AS student_id, id…` | 957 | 18.2 ms | 3.19 ms | 8153 / 0 | Seq Scan person ×1; Index Scan person_pkey ×1; Index Scan teaching_relationship_student_cover_idx ×1; Index Only Scan person_name_one_primary_key ×1914; Seq Scan lineage ×1 |

### `lineage.paths` — личността от последното поколение; limit 50

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `WITH up …` | 192 | 4.97 ms | 2.62 ms | 5208 / 0 | Seq Scan lineage ×254; Index Scan person_pkey ×662; Index Only Scan person_name_one_primary_key ×656; Index Scan teaching_relationship_student_cover_idx ×254 |
| 2 | `SELECT id::text AS id, slug, life_status, stewar…` | 116 | 0.82 ms | 0.29 ms | 963 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×116; Index Scan person_name_person_id_idx ×116 |
| 3 | `SELECT id::text AS id, slug, life_status, stewar…` | 91 | 0.50 ms | 0.28 ms | 760 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×91; Index Scan person_name_person_id_idx ×91 |
| 4 | `SELECT id::text AS id, teacher_person_id::text A…` | 138 | 3.01 ms | 3.41 ms | 3354 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×414; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×414; Index Scan training_period_relationship_id_idx ×138 |
| 5 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 91 | 27.3 ms | 4.80 ms | 22741 / 0 | Seq Scan lineage ×92; Index Scan person_pkey ×3383; Index Only Scan person_name_one_primary_key ×3275; Index Scan teaching_relationship_student_cover_idx ×91; Index Scan teaching_relationship_teacher_cover_idx ×91 |
| 6 | `SELECT student_person_id::text AS student_id, id…` | 151 | 1.50 ms | 3.10 ms | 2124 / 0 | Index Scan teaching_relationship_student_cover_idx ×1; Index Scan person_pkey ×305; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×302 |

### `people.get` — коренът на линия 1 (броят на потомците до тавана)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT id::text AS id, slug, kind, life_status, …` | 1 | 0.05 ms | 0.17 ms | 9 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×1; Index Scan person_name_person_id_idx ×1; Seq Scan person_bio ×1; Seq Scan place ×1 |
| 2 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 1 | 0.28 ms | 2.42 ms | 193 / 0 | Seq Scan lineage ×2; Index Scan person_pkey ×30; Index Only Scan person_name_one_primary_key ×30; Index Scan teaching_relationship_student_cover_idx ×1; Index Scan teaching_relationship_teacher_cover_idx ×1 |
| 3 | `WITH d …` | 1 | 123.5 ms | 2.25 ms | 115969 / 0 | Index Scan person_pkey ×15969; Index Only Scan person_name_one_primary_key ×15543; Index Scan teaching_relationship_teacher_cover_idx ×2675; Seq Scan lineage ×1 |
| 4 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 1 | 0.15 ms | 2.95 ms | 20 / 0 | Seq Scan teaching_relationship ×1; Index Scan person_pkey ×3; Seq Scan lineage ×1; Index Only Scan person_name_one_primary_key ×3 |

### `people.get` — хъбът

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `SELECT id::text AS id, slug, kind, life_status, …` | 1 | 0.11 ms | 0.18 ms | 9 / 0 | Index Scan person_pkey ×1; Index Scan person_name_one_primary_key ×1; Index Scan person_name_person_id_idx ×1; Seq Scan person_bio ×1; Seq Scan place ×1 |
| 2 | `SELECT n.id::text AS id, up.teachers, down.stude…` | 1 | 6.72 ms | 3.08 ms | 6271 / 0 | Seq Scan lineage ×2; Index Scan person_pkey ×955; Index Only Scan person_name_one_primary_key ×930; Index Scan teaching_relationship_student_cover_idx ×1; Index Scan teaching_relationship_teacher_cover_idx ×1 |
| 3 | `WITH d …` | 1 | 11.3 ms | 1.43 ms | 14582 / 0 | Index Scan person_pkey ×1878; Index Only Scan person_name_one_primary_key ×1853; Index Scan teaching_relationship_teacher_cover_idx ×927; Seq Scan lineage ×1 |
| 4 | `SELECT l.id::text AS id, x.lineage_slug AS slug,…` | 2 | 0.21 ms | 3.58 ms | 40 / 0 | Seq Scan teaching_relationship ×2; Index Scan person_pkey ×6; Seq Scan lineage ×2; Index Only Scan person_name_one_primary_key ×6 |

### `people.students` — хъбът (926 ученици); страница 1 по име

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `s AS ( SELECT pe.student_person_id AS id, jsonb_…` | 50 | 42.4 ms | 3.53 ms | 19958 / 0 | Index Scan person_pkey ×1953; Index Only Scan person_name_one_primary_key ×1953; Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×51; Seq Scan lineage ×1; Index Scan training_period_relationship_id_idx ×926; Index Scan person_name_one_primary_key ×926; Index Scan person_name_person_id_idx ×50 |
| 2 | `SELECT s.id::text AS student_id, t.teacher_id::t…` | 42 | 1.82 ms | 1.62 ms | 1440 / 0 | Seq Scan lineage ×50; Index Scan person_pkey ×178; Index Only Scan person_name_one_primary_key ×134; Index Scan teaching_relationship_student_cover_idx ×50; Index Scan person_name_one_primary_key ×42; Index Scan person_name_person_id_idx ×42 |

### `people.students` — хъбът; последната страница (19) по име

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `s AS ( SELECT pe.student_person_id AS id, jsonb_…` | 26 | 43.1 ms | 3.48 ms | 19526 / 0 | Index Scan person_pkey ×1905; Index Only Scan person_name_one_primary_key ×1905; Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×27; Seq Scan lineage ×1; Index Scan training_period_relationship_id_idx ×926; Index Scan person_name_one_primary_key ×926; Index Scan person_name_person_id_idx ×26 |
| 2 | `SELECT s.id::text AS student_id, t.teacher_id::t…` | 12 | 0.81 ms | 1.60 ms | 538 / 0 | Seq Scan lineage ×26; Index Scan person_pkey ×62; Index Only Scan person_name_one_primary_key ×50; Index Scan teaching_relationship_student_cover_idx ×26; Index Scan person_name_one_primary_key ×12; Index Scan person_name_person_id_idx ×12 |

### `people.students` — хъбът; 12 по старшинство (профилът)

| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |
|---|---|---|---|---|---|---|
| 1 | `s AS ( SELECT pe.student_person_id AS id, jsonb_…` | 12 | 46.1 ms | 3.97 ms | 19274 / 0 | Index Scan person_pkey ×1877; Index Only Scan person_name_one_primary_key ×1877; Seq Scan person ×1; Index Scan teaching_relationship_teacher_cover_idx ×13; Seq Scan lineage ×1; Index Scan training_period_relationship_id_idx ×926; Index Scan person_name_one_primary_key ×926; Index Scan person_name_person_id_idx ×12 |
| 2 | `SELECT s.id::text AS student_id, t.teacher_id::t…` | 4 | 0.47 ms | 1.54 ms | 216 / 0 | Seq Scan lineage ×12; Index Scan person_pkey ×24; Index Only Scan person_name_one_primary_key ×20; Index Scan teaching_relationship_student_cover_idx ×12; Index Scan person_name_one_primary_key ×4; Index Scan person_name_person_id_idx ×4 |

## Изводи

- Всички 13 случая завършват под тавана от 2 s на `statement_timeout`; най-бавната измерена транзакция е 183.2 ms.
- Последователно четене на големи таблици: `teaching_relationship`, `person_name`, `person`, в заявки от най-много 46.1 ms. Това са хеш съединения, които планировчикът избира за няколкостотин реда наведнъж, и `LIMIT 1` при линиите; всяка такава заявка е под 50 ms, затова не е нужна нова миграция с индекси. При десеткратно по-голяма база измерването се повтаря.
- Целта на план §4.11 (p95 < 300 ms за API на изследователя) се проверява с `pnpm perf:api` в M13 през HTTP; тук се мерят само заявките към базата.
