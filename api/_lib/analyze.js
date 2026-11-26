// 사진 분석 v2 (/api/analyze) · 임베딩 (/api/embed)
import { ask, EMBED_MAX_TEXTS, EMBED_MAX_CHARS, embedTexts } from './openai.js';
import { capJson, scrubPII, piiValues, scrubData } from './pii.js';

// 프롬프트는 서버가 소유 (프론트에서 마음대로 못 바꿈)
// ── 사진 분석 v2 ─────────────────────────────────────────────
// 시각 · 의미 · 정보 추출 · 라이프로깅 4가지 관점. 기존 필드(caption·food·place·people·background·weather·time)도
// 함께 채워 검색·앨범·관련된 추억이 그대로 동작한다. 특정 이미지·키워드를 하드코딩하지 않는다.
const ANALYSIS_VERSION = 2;
const ANALYZE =
  '이 이미지를 분석해 JSON만 출력하라.\n' +
  '[관점]\n' +
  '1) 시각: 핵심 피사체와 구체적 시각 특징(예: 디자인·색상·패턴, 의류 종류·핏, 공간·가구), 부수적 객체.\n' +
  '2) 의미: 이미지 유형(image_type), 출처 플랫폼(확인될 때만), 상위/세부 카테고리, 핵심 주제, 내용 요약.\n' +
  '3) 정보 추출: 이미지 속 핵심 글자(extracted_text)와 유형에 맞는 구조화 정보(structured_data).\n' +
  '4) 라이프로깅: 사용자가 이 이미지를 저장한 목적 추정(확정 아님), 의미 기반 검색 키워드, 어울리는 기록 종류.\n' +
  '[규칙]\n' +
  '- 스크린샷·문서는 좋아요·댓글·공유·구독 버튼, 상태 표시줄 같은 화면 UI 요소를 무시하고 본문·제품명·문서 내용을 우선한다.\n' +
  '- place 는 실제로 촬영된 물리적 장소 유형(카페, 해변, 교실 등)만 쓴다. 스크린샷·문서·디지털 이미지는 place 를 빈 문자열로 둔다. 유튜브·인스타그램 같은 플랫폼은 place 가 아니라 source_platform 이다.\n' +
  '- 이미지에서 확인되지 않는 가격·브랜드·제품명·수치는 절대 만들어 내지 않는다. 가려지거나 흐린 글자는 "(불확실)"을 붙인다.\n' +
  '- 건강·의료 문서는 적힌 항목·수치·단위만 옮기고 의학적 판단·진단·조언을 쓰지 않는다.\n' +
  '- 사람의 이름·신원 추측, 문서에 적힌 성명·생년월일·주민등록번호·전화번호·계좌번호·주소·이메일 같은 개인 식별 정보는 어디에도(extracted_text·structured_data·caption 포함) 적지 않는다.\n' +
  '- source_platform 은 로고·앱 이름·고유한 화면 구성으로 분명할 때만 적고, 짐작하지 않는다(애매하면 빈 문자열).\n' +
  '- 보이지 않거나 판단할 수 없는 항목은 "없음"·"알 수 없음" 대신 빈 문자열("") 또는 빈 배열로 둔다.\n' +
  '- 사람이 보일 때만 people 을 쓴다. 사진의 주인공(가장 크게·앞에 보이는 사람)을 먼저 "주인공: …"으로, 뒤쪽·가장자리 인물은 "배경: …"으로 구분한다. ' +
  '옷은 "색상 + 종류 + 보이는 글자·무늬·로고"로 구체적으로(예: 빨간 축구 유니폼, 가슴에 영문 로고), 손에 든 물건·하는 행동도 함께 적는다. 신원·이름은 추측하지 않는다. ' +
  '형식: "주인공: 인원, 색상 옷 종류(보이는 글자·무늬), 들고 있는 물건·행동 / 배경: 인원, 색상 옷 종류" (사진에 실제로 보이는 것만, 예시 문구를 그대로 쓰지 않는다).\n' +
  '- food 는 보이는 음식·음료를 각각 구체적인 한국어 메뉴 이름으로 적는다. "디저트"·"아이스크림"·"음료"·"면 요리" 같은 넓은 분류로 끝내지 말고 실제 메뉴 이름(예: 빙수, 파르페, 크로플, 마라탕, 아이스 아메리카노)을 쓴다. ' +
  '토핑·재료가 분명하면 앞에 붙인다(예: 팥빙수, 망고빙수, 딸기 케이크). 넓은 분류(디저트·면 요리 등)는 food 가 아니라 search_keywords 에 넣는다.\n' +
  '- 비슷한 메뉴는 그릇·질감·모양·토핑으로 구분한다: 곱게 간 눈꽃 얼음 위에 팥·떡·과일·연유를 올렸으면 빙수, 긴 유리잔에 층층이 담았으면 파르페, 둥근 스쿱 모양이면 아이스크림·젤라또, ' +
  '국물에 면이면 국수·라면·우동처럼 면과 국물 색으로, 빵 위 크림·과일이면 케이크·타르트처럼 모양으로 고른다. 확신이 없으면 가장 가능성 높은 메뉴 이름 하나만 쓰고, 보이지 않는 메뉴는 지어내지 않는다.\n' +
  '- 음식이 주인공인 사진은 caption 과 search_keywords 에도 그 메뉴 이름을 넣는다.\n' +
  '- structured_data 의 키는 한국어로, 유형에 맞게 자유롭게 구성한다(예: 추천 제품 목록과 추천 이유, 시험명·등급·발급기관, 항목·수치·단위, 재료·조리 순서).\n' +
  '[출력 JSON]\n' +
  '{"image_type":"photo|screenshot|document|shopping_list|recipe|certificate|receipt|health_report|ticket|menu|chat|note|artwork|기타 영어 소문자 유형",' +
  '"source_platform":"확인될 때만, 아니면 빈 문자열",' +
  '"semantic_category":["상위 카테고리","세부 카테고리"],' +
  '"main_topic":"핵심 주제 한 구절",' +
  '"content_summary":"주요 내용 1~2문장",' +
  '"extracted_text":"핵심 글자 발췌(최대 300자)",' +
  '"structured_data":{},' +
  '"inferred_purpose":"저장 목적 추정 한 문장",' +
  '"search_keywords":["의미 기반 검색어·관련 표현 5~10개"],' +
  '"suggested_record_type":"moment|place|taste|shopping|document|info",' +
  '"caption":"이미지 내용 한 문장(항상 작성)",' +
  '"food":["보이는 음식·음료의 구체적인 메뉴 이름"],"place":"촬영 장소 유형 또는 빈 문자열","people":"사람이 보일 때만: 주인공: … / 배경: …",' +
  '"background":"배경·부수적 객체와 핵심 피사체의 구체적 시각 특징","weather":"날씨","time":"낮/저녁/밤 중 하나 또는 빈 문자열"}';

// 글자가 많은 유형: 1차(512px·low) 뒤 고해상도로 한 번 더 분석할 대상
const TEXT_DENSE = new Set(['screenshot', 'document', 'shopping_list', 'recipe', 'certificate', 'receipt', 'health_report', 'ticket', 'menu', 'chat', 'note']);
const RECORD_TYPES = ['moment', 'place', 'taste', 'shopping', 'document', 'info'];
const PLATFORM_WORDS = /(소셜|SNS|인스타|유튜브|틱톡|페이스북|트위터|온라인|웹사이트|앱 화면|화면|스크린샷|social|instagram|youtube|tiktok)/i;

function normalizeAnalysis(r) {
  // 개인 정보 값(성명 등)을 모아 두고 캡션·요약·발췌·키워드에서도 지운다
  const pii = [...piiValues(r.structured_data)];
  const strip = t => pii.reduce((acc, v) => acc.split(v).join(''), t).replace(/\s{2,}/g, ' ').replace(/^[의\s]+/, '').trim();
  const str = (v, n) => (typeof v === 'string' ? strip(v.trim()).slice(0, n) : '');
  const arr = (v, n, each) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [])
    .map(x => str(String(x), each)).filter(Boolean).slice(0, n);
  const imageType = (str(r.image_type, 30).toLowerCase().replace(/[^a-z_]/g, '') || 'photo');
  const source = str(r.source_platform, 40);
  let place = str(r.place, 60);
  // 플랫폼·화면을 촬영 장소로 적은 경우 비운다 ('소셜 미디어'는 장소가 아님)
  if (imageType !== 'photo' && (TEXT_DENSE.has(imageType) || source)) place = '';
  if (PLATFORM_WORDS.test(place)) place = '';
  const rec = str(r.suggested_record_type, 20);
  return {
    analysis_version: ANALYSIS_VERSION,
    image_type: imageType,
    text_dense: TEXT_DENSE.has(imageType),
    source_platform: source,
    semantic_category: arr(r.semantic_category, 4, 30),
    main_topic: str(r.main_topic, 80),
    content_summary: scrubPII(str(r.content_summary, 300)),
    extracted_text: scrubPII(str(r.extracted_text, 600)),
    structured_data: capJson(scrubData(r.structured_data && typeof r.structured_data === 'object' ? r.structured_data : {})),
    inferred_purpose: str(r.inferred_purpose, 120),
    search_keywords: arr(r.search_keywords, 12, 24),
    suggested_record_type: RECORD_TYPES.includes(rec) ? rec : 'moment',
    caption: scrubPII(str(r.caption, 160)),
    food: arr(r.food, 8, 30),
    place,
    people: str(r.people, 220),
    background: str(r.background, 200),
    weather: str(r.weather, 30),
    time: ['낮', '저녁', '밤', '아침', '오후', '새벽'].includes(str(r.time, 10)) ? str(r.time, 10) : '',
  };
}

async function analyze(b) {
  if (typeof b.image !== 'string' || !b.image.startsWith('data:image/')) return [400, { error: 'bad_image' }];
  // 기본 detail:'low' (앱이 512px로 보냄, 빠르고 저렴). 글자가 많은 이미지·사용자의 '다시 분석하기'는
  // 앱이 1280px 이미지와 detail:'high' 를 보내 글자까지 정밀하게 읽는다.
  const detail = b.detail === 'high' ? 'high' : 'low';
  const r = await ask([{ type: 'input_text', text: ANALYZE }, { type: 'input_image', image_url: b.image, detail }]);
  const n = normalizeAnalysis(r);
  // 검색 1차 선별용 256차원 임베딩 — 실패해도 사진 분석은 성공으로 돌려준다 (앱이 나중에 /api/embed 로 채움)
  let embedding;
  try { embedding = (await embedTexts([analysisEmbedText(n)]))[0]; } catch { embedding = undefined; }
  return [200, { ...n, detail, ...(embedding ? { embedding } : {}) }];
}

// 분석 결과 → 임베딩할 검색용 텍스트 (앱의 embedTextFor 와 같은 항목)
function flatText(v, out = []) {
  if (v == null) return out;
  if (Array.isArray(v)) v.forEach(x => flatText(x, out));
  else if (typeof v === 'object') Object.values(v).forEach(x => flatText(x, out));
  else if (String(v).trim()) out.push(String(v).trim());
  return out;
}
const analysisEmbedText = n => [
  n.caption, n.main_topic, n.content_summary, n.place, ...(n.food || []), n.background, n.weather, n.time,
  ...(n.search_keywords || []), ...(n.semantic_category || []), flatText(n.structured_data).join(', ').slice(0, 400),
].filter(x => typeof x === 'string' && x.trim()).join(' · ').slice(0, EMBED_MAX_CHARS);

// POST /api/embed — { text } 하나 또는 { texts: [...] } 최대 50개 → { embedding } / { embeddings }
async function embed(b) {
  const clean = t => (typeof t === 'string' ? t.trim().slice(0, EMBED_MAX_CHARS) : '');
  if (typeof b.text === 'string') {
    const t = clean(b.text);
    if (!t) return [400, { error: 'bad_request' }];
    return [200, { embedding: (await embedTexts([t]))[0] }];
  }
  if (!Array.isArray(b.texts) || !b.texts.length || b.texts.length > EMBED_MAX_TEXTS) return [400, { error: 'bad_request' }];
  const texts = b.texts.map(clean);
  // 빈 항목은 null 로 두고 나머지만 보낸다
  const idx = texts.map((t, i) => (t ? i : -1)).filter(i => i >= 0);
  const embeddings = new Array(texts.length).fill(null);
  if (idx.length) {
    const vs = await embedTexts(idx.map(i => texts[i]));
    idx.forEach((i, k) => { embeddings[i] = vs[k]; });
  }
  return [200, { embeddings }];
}

export { ANALYSIS_VERSION, ANALYZE, TEXT_DENSE, RECORD_TYPES, PLATFORM_WORDS, normalizeAnalysis, analyze, flatText, analysisEmbedText, embed };
