// main.js
// BODY QUIZ 메인 로직

const QUESTIONS_DATA = Array.isArray(window.QUESTIONS) ? window.QUESTIONS : [];
const $ = (sel) => document.querySelector(sel);

const state = {
  attempts: 0,             // 풀이 수(제출 횟수)
  correct: 0,              // 정답 수
  combo: 0,
  maxCombo: 0,
  currentIndex: null,      // QUESTIONS_DATA에서의 인덱스
  currentChoiceOrder: [],  // 화면 보기 → 원본 인덱스 매핑
  selectedDisplayIdx: null,
  answered: false,         // 이 문제에서 이미 평가했는지
  queue: [],               // 랜덤 출제용 인덱스 큐
  wrongMap: new Map(),     // id -> { index, count }

  lastResultCorrect: null,   // 마지막 채점이 정답/오답인지
  modalContext: "none",      // "answer", "review", "finish"
  seenQuestions: new Set(),  // 한 번이라도 풀어본 문제 index
  finishedNotified: false,   // 이번 라운드에서 완료 모달을 이미 띄웠는지
  lastAnsweredIndex: null,   // 직전에 푼 문제 index (다음 문제에서 바로 안 나오게)

  activeTag: "ALL",          // 현재 선택된 태그 필터
};

const WRONG_REAPPEAR_PROB = 0.4; // 틀린 문제 재출제 확률

// ---------- 유틸 ----------
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 현재 태그 필터에 index가 포함되는지 여부
function matchesActiveTag(index) {
  if (state.activeTag === "ALL") return true;
  const q = QUESTIONS_DATA[index];
  if (!q) return false;
  return (q.tag || "") === state.activeTag;
}

function buildQueue(withoutIndex = null) {
  let indices = QUESTIONS_DATA
    .map((_, i) => i)
    .filter((i) => matchesActiveTag(i));

  // 직전에 푼 문제 제외 시도
  if (withoutIndex !== null && QUESTIONS_DATA.length > 1) {
    const filtered = indices.filter((i) => i !== withoutIndex);
    if (filtered.length > 0) {
      indices = filtered;
    }
    // 만약 필터 후 아무 것도 없으면, 어쩔 수 없이 withoutIndex 포함 (1문항 태그 등)
  }

  state.queue = shuffleArray(indices);
}

// ---------- UI ----------
function updateStats() {
  $("#stat-total-questions").textContent = QUESTIONS_DATA.length;
  $("#stat-count").textContent = state.attempts;
  $("#stat-correct").textContent = state.correct;
  const acc = state.attempts > 0 ? Math.round((state.correct / state.attempts) * 100) : 0;
  $("#stat-accuracy").textContent = acc;
}

function updateCombo(pop = false) {
  const comboEl = $("#combo-display");
  const c = Math.max(1, state.combo);
  comboEl.textContent = `COMBO x${c}`;
  if (pop && state.combo > 1) {
    comboEl.classList.remove("pop");
    void comboEl.offsetWidth;
    comboEl.classList.add("pop");
  }
}

function renderWrongList() {
  const list = $("#wrong-list");
  list.innerHTML = "";
  if (state.wrongMap.size === 0) {
    const empty = document.createElement("div");
    empty.style.color = "#6b7280";
    empty.style.fontSize = "11px";
    empty.textContent = "아직 틀린 문제가 없습니다. 😼";
    list.appendChild(empty);
    return;
  }

  for (const [id, info] of state.wrongMap.entries()) {
    const q = QUESTIONS_DATA[info.index];
    if (!q) continue;

    const item = document.createElement("div");
    item.className = "wrong-item";
    item.dataset.index = info.index.toString();

    const tag = document.createElement("div");
    tag.className = "wrong-tag";
    tag.textContent = `[${q.tag || "NO TAG"}] ${id}`;

    const text = document.createElement("div");
    text.className = "wrong-text";
    text.textContent =
      q.prompt.length > 50 ? q.prompt.slice(0, 50) + "..." : q.prompt;

    const cnt = document.createElement("div");
    cnt.className = "wrong-count";
    cnt.textContent = `틀린 횟수: ${info.count}`;

    item.appendChild(tag);
    item.appendChild(text);
    item.appendChild(cnt);

    // 클릭 시 해설 팝업 (복습용)
    item.addEventListener("click", () => {
      showExplanationFromWrong(info.index);
    });

    list.appendChild(item);
  }
}

// 태그 필터 UI 초기화
function buildTagFilterUI() {
  const select = $("#tag-filter-select");
  if (!select) return;

  const tags = new Set();
  QUESTIONS_DATA.forEach((q) => {
    if (q.tag) tags.add(q.tag);
  });

  // 기존 옵션 날리고 다시
  select.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "ALL";
  optAll.textContent = "전체 태그";
  select.appendChild(optAll);

  Array.from(tags)
    .sort()
    .forEach((tag) => {
      const o = document.createElement("option");
      o.value = tag;
      o.textContent = tag;
      select.appendChild(o);
    });

  select.value = state.activeTag;

  select.addEventListener("change", () => {
    state.activeTag = select.value;
    state.lastAnsweredIndex = null;
    // 현재 태그에 해당하는 문제가 없으면 안내
    const anyMatch = QUESTIONS_DATA.some((_, i) => matchesActiveTag(i));
    if (!anyMatch) {
      state.queue = [];
      state.currentIndex = null;
      // 화면에 안내 문구 출력
      $("#q-id").textContent = "문제 없음";
      $("#q-tag").textContent = "";
      $("#q-text").textContent = "선택한 태그에 해당하는 문제가 없습니다.";
      $("#choices").innerHTML = "";
      $("#feedback-inline").textContent = "";
      $("#repeat-banner").classList.remove("show");
      return;
    }
    buildQueue();
    renderQuestion();
  });
}

// ---------- 모달 ----------
function showModal({ title, type, sections }) {
  const overlay = $("#modal-overlay");
  const t = $("#modal-title");
  const body = $("#modal-body");

  t.textContent = title;
  t.className = "modal-title " + (type || "");

  body.innerHTML = "";
  (sections || []).forEach((sec) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-section";

    if (sec.heading) {
      const head = document.createElement("div");
      head.className = "modal-section-head";
      head.textContent = sec.heading;
      wrap.appendChild(head);
    }

    if (sec.text) {
      const txt = document.createElement("div");
      txt.className = "modal-section-text";
      txt.textContent = sec.text;
      wrap.appendChild(txt);
    }

    if (sec.explanation) {
      const exp = document.createElement("div");
      exp.className = "modal-section-exp";
      exp.textContent = sec.explanation;
      wrap.appendChild(exp);
    }

    body.appendChild(wrap);
  });

  overlay.style.display = "flex";
}

function hideModal() {
  const overlay = $("#modal-overlay");
  overlay.style.display = "none";
  state.modalContext = "none";
}

// 오답노트에서 해설만 보는 경우
function showExplanationFromWrong(index) {
  const q = QUESTIONS_DATA[index];
  if (!q) return;

  const correctIdx = q.correctIndex ?? 0;
  const correctChoice = (q.choices || [])[correctIdx];

  const sections = [];

  sections.push({
    heading: `[${q.id || "-"}] ${q.tag || ""}`,
    text: `Q. ${q.prompt}`,
    explanation: "",
  });

  if (correctChoice) {
    sections.push({
      heading: "정답 보기",
      text: correctChoice.text,
      explanation: correctChoice.explanation || "",
    });
  }

  sections.push({
    heading: "선지별 해설 (요약)",
    text: "",
    explanation: "",
  });

  (q.choices || []).forEach((choice, i) => {
    const letter = String.fromCharCode(65 + i);
    sections.push({
      heading: `${letter}. ${choice.text}`,
      text: "",
      explanation: choice.explanation || "",
    });
  });

  state.modalContext = "review";
  showModal({
    title: "오답노트 해설",
    type: "",
    sections,
  });

  const footer = document.querySelector(".modal-footer");
  footer.innerHTML = "";
  const closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "닫기";
  closeBtn.addEventListener("click", () => {
    hideModal();
  });
  footer.appendChild(closeBtn);
}

// 라운드 완료
function showFinishModal() {
  state.modalContext = "finish";
  const sections = [
    {
      heading: "🎉 모든 문제를 다 풀었습니다!",
      text: "",
      explanation: "이번 라운드에서 준비된 모든 문항을 한 번 이상 풀었고,\n" +
                   "오답노트도 모두 정리되었습니다.\n" +
                   "이제 재도전으로 타임어택 느낌으로 다시 풀어도 좋고,\n" +
                   "다른 과목으로 넘어가도 좋습니다.",
    }
  ];

  showModal({
    title: "라운드 완료",
    type: "correct",
    sections,
  });

  const footer = document.querySelector(".modal-footer");
  footer.innerHTML = "";

  const retryBtn = document.createElement("button");
  retryBtn.className = "modal-close";
  retryBtn.textContent = "재도전 하기";
  retryBtn.addEventListener("click", () => {
    state.seenQuestions.clear();
    state.finishedNotified = false;
    state.lastAnsweredIndex = null;
    state.combo = 0;
    updateCombo(false);
    buildQueue();
    hideModal();
    renderQuestion();
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "modal-close";
  closeBtn.textContent = "닫기";
  closeBtn.style.marginLeft = "6px";
  closeBtn.addEventListener("click", () => {
    hideModal();
  });

  footer.appendChild(retryBtn);
  footer.appendChild(closeBtn);
}

// ---------- 문제 선택 ----------
function pickNextQuestionIndex() {
  const avoid = state.lastAnsweredIndex;

  // 1) 오답 후보 (현재 태그 안에서만, 직전 문제 제외)
  const wrongIds = Array.from(state.wrongMap.keys());
  const wrongIndicesAll = wrongIds.map((id) => state.wrongMap.get(id).index);
  const wrongCandidates = wrongIndicesAll.filter(
    (idx) => idx !== avoid && matchesActiveTag(idx)
  );

  if (wrongCandidates.length > 0 && Math.random() < WRONG_REAPPEAR_PROB) {
    const idx = wrongCandidates[Math.floor(Math.random() * wrongCandidates.length)];
    return idx;
  }

  // 2) 일반 큐 (현재 태그 안에서만)
  if (state.queue.length === 0) {
    buildQueue(avoid);
  }

  if (state.queue.length === 0) {
    // 현재 태그에 해당하는 문제가 아예 없는 경우
    return null;
  }

  let idx = state.queue.shift();
  if (idx === avoid && QUESTIONS_DATA.length > 1 && state.queue.length > 0) {
    const alt = state.queue.shift();
    state.queue.push(idx);
    idx = alt;
  }

  return idx;
}

// ---------- 문제 렌더링 ----------
function renderQuestion() {
  const card = $("#card-main");
  const banner = $("#repeat-banner");

  if (!QUESTIONS_DATA.length) {
    $("#q-id").textContent = "문제 없음";
    $("#q-tag").textContent = "";
    $("#q-text").textContent = "QUESTIONS 배열에 문제를 추가해주세요.";
    $("#choices").innerHTML = "";
    $("#feedback-inline").textContent = "";
    banner.classList.remove("show");
    return;
  }

  const idx = pickNextQuestionIndex();

  if (idx === null || idx === undefined || !QUESTIONS_DATA[idx]) {
    $("#q-id").textContent = "문제 없음";
    $("#q-tag").textContent = "";
    $("#q-text").textContent = "선택한 태그에 해당하는 문제가 없습니다.";
    $("#choices").innerHTML = "";
    $("#feedback-inline").textContent = "";
    banner.classList.remove("show");
    return;
  }

  state.currentIndex = idx;
  state.answered = false;
  state.selectedDisplayIdx = null;
  state.lastResultCorrect = null;

  // 컷씬 느낌 전환
  card.classList.remove("scene-transition");
  void card.offsetWidth;
  card.classList.add("scene-transition");

  const q = QUESTIONS_DATA[idx];

  $("#q-id").textContent = `문제 ${q.id || "-"}`;
  $("#q-tag").textContent = q.tag ? `[${q.tag}]` : "";
  $("#q-text").textContent = q.prompt || "";
  $("#feedback-inline").textContent = "";

  // 재등장 오답 문제 경고등
  if (q.id && state.wrongMap.has(q.id)) {
    banner.classList.add("show");
  } else {
    banner.classList.remove("show");
  }

  const choicesBox = $("#choices");
  choicesBox.innerHTML = "";

  // 보기 섞기
  const originalChoices = (q.choices || []).map((c, i) => ({
    origIndex: i,
    text: c.text,
    explanation: c.explanation || "",
  }));
  const shuffled = shuffleArray(originalChoices);
  state.currentChoiceOrder = shuffled.map((c) => c.origIndex);

  shuffled.forEach((c, displayIdx) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = `${String.fromCharCode(65 + displayIdx)}. ${c.text}`;
    btn.addEventListener("click", () => selectChoice(displayIdx));
    choicesBox.appendChild(btn);
  });

  $("#tip").textContent =
    "TIP: '가장 먼저 / 다음으로 / 직접적인 기전' 같은 단어에 주의해 봐.";
}

// 보기 선택
function selectChoice(displayIdx) {
  if (state.answered) return;
  state.selectedDisplayIdx = displayIdx;
  document.querySelectorAll(".choice-btn").forEach((btn, i) => {
    btn.classList.toggle("selected", i === displayIdx);
  });
  $("#feedback-inline").textContent = "";
}

// 제출 버튼
function submitCurrent() {
  if (state.selectedDisplayIdx == null) {
    $("#feedback-inline").textContent = "먼저 보기를 선택하고 '제출'을 눌러줘.";
    return;
  }
  if (state.answered) return;
  evaluateChoice(state.selectedDisplayIdx);
}

// ---------- 정답 평가 ----------
function evaluateChoice(displayIdx) {
  const q = QUESTIONS_DATA[state.currentIndex];
  if (!q) return;

  const mapping = state.currentChoiceOrder;
  const correctOrigIdx = q.correctIndex ?? 0;
  const chosenOrigIdx = mapping[displayIdx];

  const buttons = document.querySelectorAll(".choice-btn");
  const card = $("#card-main");

  // 정답 버튼 위치
  let correctDisplayIdx = 0;
  buttons.forEach((btn, i) => {
    const ori = mapping[i];
    const isCorrectBtn = ori === correctOrigIdx;
    if (isCorrectBtn) correctDisplayIdx = i;
  });

  const chosenBtn = buttons[displayIdx];
  const isCorrect = chosenOrigIdx === correctOrigIdx;

  // 스타일
  buttons.forEach((btn, i) => {
    const ori = mapping[i];
    const isCorrectBtn = ori === correctOrigIdx;
    if (isCorrectBtn) {
      btn.classList.add("correct");
    }
  });
  if (!isCorrect) {
    chosenBtn.classList.add("wrong");
  }

  // 통계
  state.attempts += 1;
  state.seenQuestions.add(state.currentIndex);
  state.answered = true;
  state.lastResultCorrect = isCorrect;
  state.lastAnsweredIndex = state.currentIndex;

  const chosenChoice = (q.choices || [])[chosenOrigIdx] || {};
  const correctChoice = (q.choices || [])[correctOrigIdx] || {};
  const chosenLetter = String.fromCharCode(65 + displayIdx);
  const correctLetter = String.fromCharCode(65 + correctDisplayIdx);

  let sections;

  if (isCorrect) {
    state.correct += 1;
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    updateCombo(true);

    // 카드 플래시
    card.classList.remove("correct-flash");
    void card.offsetWidth;
    card.classList.add("correct-flash");
    setTimeout(() => {
      card.classList.remove("correct-flash");
    }, 500);

    sections = [
      {
        heading: `내가 고른 보기 (${chosenLetter})`,
        text: chosenChoice.text || "",
        explanation: chosenChoice.explanation || "",
      },
    ];

    // 오답노트에서 제거
    if (q.id && state.wrongMap.has(q.id)) {
      state.wrongMap.delete(q.id);
      renderWrongList();
    }
  } else {
    state.combo = 0;
    updateCombo(false);

    // 카드 흔들림
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    setTimeout(() => {
      card.classList.remove("shake");
    }, 400);

    sections = [
      {
        heading: `내가 고른 보기 (${chosenLetter})`,
        text: chosenChoice.text || "",
        explanation: chosenChoice.explanation || "",
      },
      {
        heading: `정답 보기 (${correctLetter})`,
        text: correctChoice.text || "",
        explanation: correctChoice.explanation || "",
      },
    ];

    // 오답노트 기록
    if (q.id) {
      const prev = state.wrongMap.get(q.id);
      if (prev) {
        prev.count += 1;
        state.wrongMap.set(q.id, prev);
      } else {
        state.wrongMap.set(q.id, { index: state.currentIndex, count: 1 });
      }
      renderWrongList();
    }
  }

  updateStats();

  // 해설 모달: 정답/오답 모두 "다음 문제 풀기"
  state.modalContext = "answer";
  showModal({
    title: isCorrect ? "✔ 정답!" : "✖ 오답",
    type: isCorrect ? "correct" : "wrong",
    sections,
  });

  const footer = document.querySelector(".modal-footer");
  footer.innerHTML = "";
  const nextBtn = document.createElement("button");
  nextBtn.className = "modal-close";
  nextBtn.textContent = "다음 문제 풀기";
  nextBtn.addEventListener("click", () => {
    hideModal();
    renderQuestion();
  });
  footer.appendChild(nextBtn);

  // 보기 비활성화
  buttons.forEach((btn) => (btn.disabled = true));

  // 전체 기준 클리어 조건
  if (
    !state.finishedNotified &&
    state.seenQuestions.size === QUESTIONS_DATA.length &&
    state.wrongMap.size === 0
  ) {
    state.finishedNotified = true;
    showFinishModal();
  }
}

// ---------- 초기화 ----------
function init() {
  if (!QUESTIONS_DATA.length) {
    console.warn("QUESTIONS가 비어 있습니다. questions.js를 확인하세요.");
  }

  buildTagFilterUI();
  buildQueue();
  updateStats();
  updateCombo(false);
  renderWrongList();
  renderQuestion();

  $("#btn-submit").addEventListener("click", submitCurrent);

  $("#btn-clear-wrong").addEventListener("click", () => {
    state.wrongMap.clear();
    renderWrongList();
  });

  const defaultClose = $("#modal-close");
  if (defaultClose) {
    defaultClose.addEventListener("click", () => {
      hideModal();
    });
  }

  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id !== "modal-overlay") return;
    if (state.modalContext === "answer") {
      hideModal();
      renderQuestion();
    } else {
      hideModal();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
