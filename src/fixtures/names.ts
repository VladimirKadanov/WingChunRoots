// Name parts for the fictional demo people (D20). Combinations are random and the surnames of
// the Western and Bulgarian sets are deliberately made-up ("Testov", "Samplewood"), so no record
// describes a real person. The Chinese characters are common nature words; the readings are
// given per character (Jyutping with tone numbers, pinyin with tone marks, Hong Kong
// government-style romanization).

export interface HanChar {
  trad: string;
  simp: string;
  jyutping: string;
  pinyin: string;
  hk: string;
}

export const HAN_SURNAMES: readonly HanChar[] = [
  { trad: '陳', simp: '陈', jyutping: 'can4', pinyin: 'Chén', hk: 'Chan' },
  { trad: '李', simp: '李', jyutping: 'lei5', pinyin: 'Lǐ', hk: 'Lee' },
  { trad: '張', simp: '张', jyutping: 'zoeng1', pinyin: 'Zhāng', hk: 'Cheung' },
  { trad: '黃', simp: '黄', jyutping: 'wong4', pinyin: 'Huáng', hk: 'Wong' },
  { trad: '何', simp: '何', jyutping: 'ho4', pinyin: 'Hé', hk: 'Ho' },
  { trad: '林', simp: '林', jyutping: 'lam4', pinyin: 'Lín', hk: 'Lam' },
  { trad: '劉', simp: '刘', jyutping: 'lau4', pinyin: 'Liú', hk: 'Lau' },
  { trad: '吳', simp: '吴', jyutping: 'ng4', pinyin: 'Wú', hk: 'Ng' },
  { trad: '鄭', simp: '郑', jyutping: 'zeng6', pinyin: 'Zhèng', hk: 'Cheng' },
  { trad: '馮', simp: '冯', jyutping: 'fung4', pinyin: 'Féng', hk: 'Fung' },
  { trad: '蘇', simp: '苏', jyutping: 'sou1', pinyin: 'Sū', hk: 'So' },
  { trad: '謝', simp: '谢', jyutping: 'ze6', pinyin: 'Xiè', hk: 'Tse' },
  { trad: '麥', simp: '麦', jyutping: 'mak6', pinyin: 'Mài', hk: 'Mak' },
  { trad: '郭', simp: '郭', jyutping: 'gwok3', pinyin: 'Guō', hk: 'Kwok' },
  { trad: '盧', simp: '卢', jyutping: 'lou4', pinyin: 'Lú', hk: 'Lo' },
  { trad: '羅', simp: '罗', jyutping: 'lo4', pinyin: 'Luó', hk: 'Law' },
];

export const HAN_GIVEN: readonly HanChar[] = [
  { trad: '星', simp: '星', jyutping: 'sing1', pinyin: 'xīng', hk: 'Sing' },
  { trad: '河', simp: '河', jyutping: 'ho4', pinyin: 'hé', hk: 'Ho' },
  { trad: '松', simp: '松', jyutping: 'cung4', pinyin: 'sōng', hk: 'Chung' },
  { trad: '竹', simp: '竹', jyutping: 'zuk1', pinyin: 'zhú', hk: 'Chuk' },
  { trad: '石', simp: '石', jyutping: 'sek6', pinyin: 'shí', hk: 'Shek' },
  { trad: '晴', simp: '晴', jyutping: 'cing4', pinyin: 'qíng', hk: 'Ching' },
  { trad: '霖', simp: '霖', jyutping: 'lam4', pinyin: 'lín', hk: 'Lam' },
  { trad: '嵐', simp: '岚', jyutping: 'laam4', pinyin: 'lán', hk: 'Laam' },
  { trad: '峰', simp: '峰', jyutping: 'fung1', pinyin: 'fēng', hk: 'Fung' },
  { trad: '溪', simp: '溪', jyutping: 'kai1', pinyin: 'xī', hk: 'Kai' },
  { trad: '葵', simp: '葵', jyutping: 'kwai4', pinyin: 'kuí', hk: 'Kwai' },
  { trad: '樺', simp: '桦', jyutping: 'waa6', pinyin: 'huà', hk: 'Wa' },
  { trad: '楓', simp: '枫', jyutping: 'fung1', pinyin: 'fēng', hk: 'Fung' },
  { trad: '翠', simp: '翠', jyutping: 'ceoi3', pinyin: 'cuì', hk: 'Chui' },
  { trad: '曦', simp: '曦', jyutping: 'hei1', pinyin: 'xī', hk: 'Hei' },
  { trad: '嘉', simp: '嘉', jyutping: 'gaa1', pinyin: 'jiā', hk: 'Ka' },
  { trad: '朗', simp: '朗', jyutping: 'long5', pinyin: 'lǎng', hk: 'Long' },
  { trad: '澄', simp: '澄', jyutping: 'cing4', pinyin: 'chéng', hk: 'Ching' },
  { trad: '灝', simp: '灏', jyutping: 'hou6', pinyin: 'hào', hk: 'Ho' },
  { trad: '穎', simp: '颖', jyutping: 'wing6', pinyin: 'yǐng', hk: 'Wing' },
  { trad: '韻', simp: '韵', jyutping: 'wan5', pinyin: 'yùn', hk: 'Wan' },
  { trad: '蔚', simp: '蔚', jyutping: 'wai3', pinyin: 'wèi', hk: 'Wai' },
  { trad: '悅', simp: '悦', jyutping: 'jyut6', pinyin: 'yuè', hk: 'Yuet' },
  { trad: '恩', simp: '恩', jyutping: 'jan1', pinyin: 'ēn', hk: 'Yan' },
  { trad: '琛', simp: '琛', jyutping: 'sam1', pinyin: 'chēn', hk: 'Sam' },
  { trad: '舟', simp: '舟', jyutping: 'zau1', pinyin: 'zhōu', hk: 'Chau' },
];

export const WESTERN_GIVEN: readonly string[] = [
  'Anna', 'Boris', 'Clara', 'Daniel', 'Elena', 'Felix', 'Greta', 'Hugo', 'Irena', 'Jonas',
  'Katrin', 'Lukas', 'Marta', 'Nikos', 'Olga', 'Pavel', 'Rosa', 'Stefan', 'Tanya', 'Viktor',
  'Zora', 'Marco', 'Sofia', 'Liam', 'Nora', 'Oscar', 'Paula', 'Ruben', 'Selma', 'Theo',
];

export const WESTERN_SURNAMES: readonly string[] = [
  'Testov', 'Demov', 'Samplewood', 'Mockley', 'Stubbard', 'Fixwell', 'Seedorf', 'Placeman',
  'Proberts', 'Dummond', 'Examplar', 'Trialson', 'Pilotti', 'Draftley', 'Sketchley', 'Mockridge',
  'Testerman', 'Demoulin', 'Fauxberg', 'Notreal', 'Dataman', 'Loremby', 'Ipsumov', 'Dolorova',
];

/** Bulgarian given names (Cyrillic, Bulgarian streamlined romanization, grammatical gender). */
export const CYRILLIC_GIVEN: readonly { cyr: string; lat: string; female: boolean }[] = [
  { cyr: 'Иван', lat: 'Ivan', female: false },
  { cyr: 'Петър', lat: 'Petar', female: false },
  { cyr: 'Мария', lat: 'Mariya', female: true },
  { cyr: 'Елена', lat: 'Elena', female: true },
  { cyr: 'Георги', lat: 'Georgi', female: false },
  { cyr: 'Николай', lat: 'Nikolay', female: false },
  { cyr: 'Десислава', lat: 'Desislava', female: true },
  { cyr: 'Стефан', lat: 'Stefan', female: false },
  { cyr: 'Христо', lat: 'Hristo', female: false },
  { cyr: 'Йорданка', lat: 'Yordanka', female: true },
  { cyr: 'Цветан', lat: 'Tsvetan', female: false },
  { cyr: 'Жана', lat: 'Zhana', female: true },
];

/** Made-up Bulgarian surnames with their masculine and feminine forms. */
export const CYRILLIC_SURNAMES: readonly { m: [string, string]; f: [string, string] }[] = [
  { m: ['Тестов', 'Testov'], f: ['Тестова', 'Testova'] },
  { m: ['Демов', 'Demov'], f: ['Демова', 'Demova'] },
  { m: ['Примеров', 'Primerov'], f: ['Примерова', 'Primerova'] },
  { m: ['Пробнов', 'Probnov'], f: ['Пробнова', 'Probnova'] },
  { m: ['Фиктивов', 'Fiktivov'], f: ['Фиктивова', 'Fiktivova'] },
  { m: ['Макетов', 'Maketov'], f: ['Макетова', 'Maketova'] },
];
