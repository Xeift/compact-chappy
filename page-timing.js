(() => {
  if (window.__compactChappyTiming?.loaded) return;

  window.__compactChappyTiming = {
    build: "timeline-completion-motion-1",
    loaded: true,
    installedAt: Date.now(),
    conversationRequests: 0,
    telemetryRequests: 0,
    lastConversationPath: null,
    sseLines: 0,
    reasoningStartSeen: false,
    reasoningEndSeen: false,
    timelineMounted: false,
    mountAttempts: 0,
    lastMountState: null,
    domTrace: [],
    traceActive: false,
    lastError: null
  };

  const originalFetch = window.fetch;
  const statesByExchangeId = new Map();
  let activeState = null;
  let turnSequence = 0;
  let mountQueued = false;
  const domTraceSeen = new Set();
  const DOM_TRACE_LIMIT = 300;

  function summarizeElement(element) {
    if (!(element instanceof Element)) return null;

    const text = (element.innerText || element.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      tag: element.tagName,
      id: element.id || null,
      class:
        typeof element.className === "string"
          ? element.className.slice(0, 300)
          : null,
      role: element.getAttribute("role"),
      data: Object.fromEntries(
        [...element.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .slice(0, 20)
          .map((attribute) => [attribute.name, attribute.value])
      ),
      text: text.slice(0, 300),
      html: element.outerHTML.slice(0, 1500)
    };
  }

  function summarizeAncestors(element, depth = 5) {
    const ancestors = [];
    let current = element?.parentElement ?? null;

    for (let index = 0; current && index < depth; index += 1) {
      ancestors.push(summarizeElement(current));
      current = current.parentElement;
    }

    return ancestors;
  }

  function collectDomSnapshot() {
    const main = document.querySelector("main") || document.body;

    const activityCandidates = [
      ...document.querySelectorAll(
        '[class*="activity"], [class*="reason"], [class*="agent"]'
      )
    ]
      .filter((element) => !element.closest(".cui-turn-timeline"))
      .slice(-25)
      .map(summarizeElement);

    const textCandidates = [...main.querySelectorAll("div, span, button")]
      .filter((element) => {
        if (element.closest(".cui-turn-timeline")) return false;
        const text = (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!text || text.length > 220) return false;
        return element.children.length <= 4;
      })
      .slice(-35)
      .map(summarizeElement);

    return {
      activityCandidates,
      textCandidates
    };
  }

  function recordDomTrace(
    stage,
    details = null,
    element = null,
    includeSnapshot = true
  ) {
    const timing = window.__compactChappyTiming;
    if (timing.domTrace.length >= DOM_TRACE_LIMIT) return;

    timing.domTrace.push({
      seq: timing.domTrace.length + 1,
      stage,
      atMs: Number(performance.now().toFixed(1)),
      url: location.href,
      mountState: timing.lastMountState,
      details,
      element: summarizeElement(element),
      ancestors: element ? summarizeAncestors(element) : [],
      snapshot: includeSnapshot ? collectDomSnapshot() : null
    });
  }

  function recordMutationNode(node, kind) {
    if (!window.__compactChappyTiming.traceActive) return;

    const element =
      node instanceof Element
        ? node
        : node?.parentElement instanceof Element
          ? node.parentElement
          : null;

    if (!element || element.closest(".cui-turn-timeline")) return;

    const summary = summarizeElement(element);
    if (!summary?.text) return;

    const signature = [
      kind,
      summary.tag,
      summary.id,
      summary.class,
      summary.text.slice(0, 120)
    ].join("|");

    if (domTraceSeen.has(signature)) return;
    domTraceSeen.add(signature);

    recordDomTrace(`dom-${kind}`, null, element, false);
  }

  function setMountState(nextState, element = null) {
    const timing = window.__compactChappyTiming;
    if (timing.lastMountState !== nextState && timing.traceActive) {
      recordDomTrace(`mount-${nextState}`, null, element);
    }
    timing.lastMountState = nextState;
  }

  window.__compactChappyTiming.exportDomTrace = () =>
    JSON.stringify(window.__compactChappyTiming.domTrace, null, 2);

  window.__compactChappyTiming.clearDomTrace = () => {
    window.__compactChappyTiming.domTrace.length = 0;
    domTraceSeen.clear();
  };

  function epochSecondsToPerformanceTime(epochSeconds) {
    return performance.now() + epochSeconds * 1000 - Date.now();
  }

  function isEnhancedThinkingEnabled() {
    return document.documentElement.classList.contains(
      "cui-enhanced-thinking"
    );
  }

  function formatDuration(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  }

  function formatCompactDuration(ms) {
    return formatDuration(ms).replace(" ", "");
  }

  function animateMotion(state, element, keyframes, delay, duration, easing) {
    const animation = element.animate(keyframes, {
      delay,
      duration,
      easing,
      fill: "forwards"
    });

    state.completionAnimations.push(animation);
    return animation;
  }

  function createMotionPath(state, data, className) {
    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );

    path.setAttribute("d", data);
    path.setAttribute("class", className);
    state.motionOverlay.appendChild(path);
    return path;
  }

  function drawMotionPath(state, path, delay, duration) {
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;

    animateMotion(
      state,
      path,
      [
        { strokeDashoffset: length, opacity: 0 },
        { opacity: 0.8, offset: 0.15 },
        { strokeDashoffset: 0, opacity: 0.8 }
      ],
      delay,
      duration,
      "cubic-bezier(.22, 1, .36, 1)"
    );
  }

  function getTimelinePoint(timeline, element) {
    const box = element.getBoundingClientRect();
    const origin = timeline.getBoundingClientRect();

    return {
      x: box.left - origin.left + box.width / 2,
      y: box.top - origin.top + box.height / 2
    };
  }

  function cleanupCompletionMotion(state) {
    for (const animation of state.completionAnimations) {
      animation.cancel();
    }

    state.completionAnimations.length = 0;

    if (state.completionFrame != null) {
      cancelAnimationFrame(state.completionFrame);
      state.completionFrame = null;
    }

    state.timeline
      .querySelectorAll(".cui-motion-overlay, .cui-motion-echo")
      .forEach((element) => element.remove());

    const total = state.timeline.querySelector(".cui-timeline-total");
    const number = total.querySelector("span");

    number.textContent = formatCompactDuration(
      state.lastTokenAt - state.feReqAt
    );
    number.style.width = "";
    number.style.textAlign = "";

    total.style.opacity = "1";
    total.style.transform = "";
    total.style.filter = "";

    delete state.timeline.dataset.completionMotion;
    state.timeline.dataset.completionDone = "true";
    state.completionAnimationDone = true;
  }

  function startCompletionAnimation(state) {
    if (
      state.completionAnimationStarted ||
      typeof state.lastTokenAt !== "number"
    ) {
      return;
    }

    state.completionAnimationStarted = true;
    state.timeline.dataset.completionMotion = "true";

    const timeline = state.timeline;
    const sources = [
      ...timeline.querySelectorAll(".cui-timeline-duration")
    ];
    const total = timeline.querySelector(".cui-timeline-total");
    const number = total.querySelector("span");
    const finalText = formatCompactDuration(
      state.lastTokenAt - state.feReqAt
    );

    number.textContent = finalText;
    number.style.width = `${number.getBoundingClientRect().width}px`;
    number.style.textAlign = "right";
    number.textContent = "0.0s";

    const overlay = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("class", "cui-motion-overlay");
    timeline.appendChild(overlay);
    state.motionOverlay = overlay;

    const points = sources.map((source) =>
      getTimelinePoint(timeline, source)
    );
    const target = getTimelinePoint(timeline, total);

    const left =
      points[0].x - sources[0].getBoundingClientRect().width / 2 - 4;
    const right =
      points[2].x + sources[2].getBoundingClientRect().width / 2 + 4;
    const center = (left + right) / 2;
    const barY = points[0].y - 13;
    const capY = barY + 5;
    const labelY = barY - 13;
    const dx = center - target.x;
    const dy = labelY - target.y;

    const sumAt = 220;
    const revealAt = sumAt + 300;
    const lockAt = revealAt + 1300;
    const moveAt = lockAt + 360;
    const launchAt = moveAt + 130;
    const arrivalAt = launchAt + 430;
    const finishAt = arrivalAt + 420;

    const leftBrace = createMotionPath(
      state,
      `M ${left} ${capY} Q ${left} ${barY} ${left + 7} ${barY} H ${center - 8} Q ${center - 3} ${barY} ${center} ${barY - 4}`,
      "cui-brace-mark"
    );
    const rightBrace = createMotionPath(
      state,
      `M ${right} ${capY} Q ${right} ${barY} ${right - 7} ${barY} H ${center + 8} Q ${center + 3} ${barY} ${center} ${barY - 4}`,
      "cui-brace-mark"
    );

    drawMotionPath(state, leftBrace, sumAt, 400);
    drawMotionPath(state, rightBrace, sumAt, 400);

    for (const source of sources) {
      animateMotion(
        state,
        source,
        [
          { color: "#a3a3a3", textShadow: "0 0 0px #fff0" },
          {
            color: "#f5f5f5",
            textShadow: "0 0 5px #fff6",
            offset: 0.25
          },
          { color: "#a3a3a3", textShadow: "0 0 0px #fff0" }
        ],
        sumAt,
        530,
        "cubic-bezier(.22, 1, .36, 1)"
      );
    }

    animateMotion(
      state,
      total,
      [
        {
          opacity: 0,
          transform: `translate(${dx}px, ${dy + 3}px)`,
          filter: "blur(1px)"
        },
        {
          opacity: 1,
          transform: `translate(${dx}px, ${dy}px)`,
          filter: "blur(0px)"
        }
      ],
      revealAt,
      220,
      "cubic-bezier(.22, 1, .36, 1)"
    );

    const startedAt = performance.now();
    const counter = (now) => {
      const progress = Math.max(
        0,
        Math.min(1, (now - startedAt - revealAt) / 1300)
      );
      const eased = progress * progress * (3 - 2 * progress);
      const totalMs = Math.max(0, state.lastTokenAt - state.feReqAt);

      number.textContent = `${(totalMs * eased / 1000).toFixed(1)}s`;

      if (progress < 1) {
        state.completionFrame = requestAnimationFrame(counter);
      }
    };
    state.completionFrame = requestAnimationFrame(counter);

    for (const brace of [leftBrace, rightBrace]) {
      animateMotion(
        state,
        brace,
        [
          { opacity: 0.8, transform: "translateY(0) scaleX(1)" },
          {
            opacity: 0.9,
            transform: "translateY(-6px) scaleX(.16)",
            offset: 0.72
          },
          {
            opacity: 0,
            transform: "translateY(-7px) scaleX(.06)"
          }
        ],
        moveAt,
        230,
        "cubic-bezier(.6, 0, .2, 1)"
      );
    }

    animateMotion(
      state,
      total,
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(1, 1)`,
          filter: "blur(0px) drop-shadow(0 0 0px #fff0)",
          opacity: 1
        },
        {
          transform: `translate(${dx - 8}px, ${dy - 2}px) scale(.7, 1.12)`,
          filter: "blur(.15px) drop-shadow(0 0 8px #fff)",
          opacity: 1
        }
      ],
      moveAt,
      launchAt - moveAt,
      "cubic-bezier(.7, 0, 1, .35)"
    );

    const positions = Array.from({ length: 49 }, (_, index) => {
      const t = index / 48;
      const remaining = (1 - t) ** 4;

      return {
        t,
        x: 2 + (dx - 10) * remaining,
        y: (dy - 2) * (1 - t ** 2.5)
      };
    });

    const flightFrames = positions.map(({ t, x, y }) => {
      const stretch = Math.sin(Math.PI * t) ** 2.2;
      const flare = Math.sin(Math.PI * t);
      const scaleX = 1 + 1.25 * stretch;
      const scaleY = 1 - 0.42 * stretch;

      return {
        offset: t,
        transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`,
        filter: `blur(${0.8 * stretch}px) drop-shadow(0 0 ${5 + 8 * flare}px #fff)`,
        opacity: 1 - 0.28 * stretch
      };
    });

    animateMotion(
      state,
      total,
      flightFrames,
      launchAt,
      arrivalAt - launchAt,
      "cubic-bezier(.78, 0, .08, 1)"
    );

    const totalBox = total.getBoundingClientRect();
    const timelineBox = timeline.getBoundingClientRect();

    for (let index = 0; index < 3; index += 1) {
      const echo = total.cloneNode(true);
      echo.classList.add("cui-motion-echo");
      echo.setAttribute("aria-hidden", "true");
      echo.querySelector("span").textContent = finalText;
      echo.style.left = `${totalBox.left - timelineBox.left}px`;
      echo.style.top = `${totalBox.top - timelineBox.top}px`;
      timeline.appendChild(echo);

      animateMotion(
        state,
        echo,
        flightFrames.map((frame) => ({
          ...frame,
          opacity:
            frame.offset < 0.88
              ? (0.2 - index * 0.045) *
                Math.sin(Math.PI * frame.offset)
              : 0
        })),
        launchAt + 24 + index * 24,
        arrivalAt - launchAt,
        "cubic-bezier(.78, 0, .08, 1)"
      );
    }

    const endX = target.x + 2;
    const startY = target.y + dy - 2;
    const curveData =
      `M ${target.x + dx - 8} ${startY} C ${target.x + dx * 0.45} ${startY}, ${target.x - 18} ${target.y}, ${endX} ${target.y}`;

    let traveled = 0;
    const distances = positions.map((point, index) => {
      if (index > 0) {
        traveled += Math.hypot(
          point.x - positions[index - 1].x,
          point.y - positions[index - 1].y
        );
      }

      return traveled;
    });

    for (const [width, tail, strength, blur] of [
      [12, 150, 0.16, 3.6],
      [5, 140, 0.3, 1.4],
      [1, 165, 1, 0],
      [2, 42, 0.92, 0.2]
    ]) {
      const beam = createMotionPath(
        state,
        curveData,
        "cui-flight-beam"
      );
      beam.setAttribute("stroke-width", width);
      beam.style.filter = `blur(${blur}px)`;

      const length = beam.getTotalLength();
      beam.style.strokeDasharray = `${tail} ${length + tail}`;

      animateMotion(
        state,
        beam,
        positions.map(({ t }, index) => ({
          offset: t,
          strokeDashoffset:
            tail - distances[index] / traveled * length,
          opacity:
            t === 0 || t === 1
              ? 0
              : strength * Math.sin(Math.PI * t) ** 0.6
        })),
        launchAt,
        arrivalAt - launchAt,
        "cubic-bezier(.78, 0, .08, 1)"
      );
    }

    animateMotion(
      state,
      total,
      [
        {
          transform: "translate(3px, 0) scale(1.08, .96)",
          filter: "blur(0px) drop-shadow(0 0 9px #fff)"
        },
        {
          transform: "translate(1px, 0) scale(1.02, 1)",
          filter: "blur(0px) drop-shadow(0 0 4px #fff8)",
          offset: 0.34
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          filter: "blur(0px) drop-shadow(0 0 0px #fff0)"
        }
      ],
      arrivalAt,
      260,
      "cubic-bezier(.12, .78, .2, 1)"
    );

    const impactX = totalBox.right - timelineBox.left + 2;
    const impactY =
      totalBox.top - timelineBox.top + totalBox.height / 2;

    for (const streak of [
      { y: -4, length: 42, width: 0.8, delay: 0, opacity: 0.65 },
      { y: 0, length: 76, width: 1.35, delay: 8, opacity: 1 },
      { y: 3, length: 54, width: 0.9, delay: 18, opacity: 0.72 }
    ]) {
      const line = createMotionPath(
        state,
        `M ${impactX} ${impactY + streak.y} H ${impactX + streak.length}`,
        "cui-burst-ray"
      );

      line.setAttribute("stroke-width", streak.width);
      const length = line.getTotalLength();
      line.style.strokeDasharray = `12 ${length + 12}`;

      animateMotion(
        state,
        line,
        [
          { strokeDashoffset: 12, opacity: 0 },
          {
            strokeDashoffset: -length * 0.38,
            opacity: streak.opacity,
            offset: 0.2
          },
          { strokeDashoffset: -length, opacity: 0 }
        ],
        arrivalAt + streak.delay,
        220,
        "cubic-bezier(.1, .82, .2, 1)"
      );
    }

    animateMotion(
      state,
      number,
      [
        { color: "#d4d4d4", textShadow: "0 0 0px #fff0" },
        {
          color: "#fff",
          textShadow: "0 0 8px #fff",
          offset: 0.16
        },
        {
          color: "#d4d4d4",
          textShadow: "0 0 0px #fff0"
        }
      ],
      arrivalAt,
      260,
      "cubic-bezier(.22, 1, .36, 1)"
    );

    window.setTimeout(
      () => cleanupCompletionMotion(state),
      finishAt + 40
    );
  }

  function createTimeline() {
    const timeline = document.createElement("span");
    timeline.className = "cui-turn-timeline";
    timeline.innerHTML = `
      <span class="cui-timeline-track" aria-label="Response timeline">
        <span class="cui-timeline-node" data-node="request">Request</span>
        <span class="cui-timeline-segment" data-segment="0">
          <span class="cui-timeline-line"></span>
          <span class="cui-timeline-duration">0.0 s</span>
        </span>
        <span class="cui-timeline-node" data-node="reasoningStart">CoT start</span>
        <span class="cui-timeline-segment" data-segment="1">
          <span class="cui-timeline-line"></span>
          <span class="cui-timeline-duration">0.0 s</span>
        </span>
        <span class="cui-timeline-node" data-node="reasoningEnd">CoT end</span>
        <span class="cui-timeline-segment" data-segment="2">
          <span class="cui-timeline-line"></span>
          <span class="cui-timeline-duration">0.0 s</span>
        </span>
        <span class="cui-timeline-node" data-node="lastToken">Last token</span>
        <span class="cui-timeline-total">[<span>0.0s</span>]</span>
      </span>
    `;
    return timeline;
  }

  function getLiveTurn(state) {
    if (state.liveTurn?.isConnected) return state.liveTurn;

    const turn = [...document.querySelectorAll("div[data-turn-key]")].find(
      (element) => !state.turnKeysAtStart.includes(element.dataset.turnKey)
    );

    if (turn) state.liveTurn = turn;
    return turn ?? null;
  }

  function getLiveActivityHeader(state) {
    return (
      getLiveTurn(state)?.querySelector('div[class~="group/activity-header"]') ??
      null
    );
  }

  function getRespondingStatusContainer(state) {
    const status = getLiveTurn(state)?.querySelector(
      'span[role="status"][aria-busy="true"]'
    );

    return status?.parentElement ?? null;
  }

  function getAssistantBlock(state) {
    const heading = getLiveTurn(state)?.querySelector(
      'h4[data-conversation-role="assistant"]'
    );

    return heading?.parentElement ?? null;
  }

  function getWorkedLabel(state) {
    const mounted = document.querySelector('[data-cui-timeline-host="true"]');
    if (mounted?.contains(state.timeline)) return mounted;

    const turn = getLiveTurn(state);
    if (!turn) return null;

    return (
      [...turn.querySelectorAll("span")].find((span) =>
        /^Worked for\b/i.test((span.textContent || "").trim())
      ) ?? null
    );
  }

  function clearLiveMount(state) {
    if (!state.liveMountElement) return;

    delete state.liveMountElement.dataset.cuiTimelineLive;
    state.liveMountElement = null;
  }

  function mountIntoLiveElement(state, element, mountState) {
    if (state.liveMountElement !== element) {
      clearLiveMount(state);
      state.liveMountElement = element;
      element.dataset.cuiTimelineLive = "true";
    }

    if (state.timeline.parentElement !== element) {
      element.appendChild(state.timeline);
    }

    window.__compactChappyTiming.timelineMounted = true;
    setMountState(mountState, element);
  }

  function mountTimeline(state) {
    if (!isEnhancedThinkingEnabled()) return;

    window.__compactChappyTiming.mountAttempts += 1;

    const workedLabel = getWorkedLabel(state);

    if (workedLabel) {
      clearLiveMount(state);

      if (!workedLabel.dataset.cuiNativeWorkedText) {
        workedLabel.dataset.cuiNativeWorkedText =
          (workedLabel.textContent || "").trim();
      }

      workedLabel.textContent = "";
      workedLabel.dataset.cuiTimelineHost = "true";
      if (workedLabel.parentElement) {
        workedLabel.parentElement.dataset.cuiTimelineHostContainer = "true";
      }
      workedLabel.appendChild(state.timeline);

      window.__compactChappyTiming.timelineMounted = true;
      setMountState("worked-label", workedLabel);
      return;
    }

    const liveActivityHeader = getLiveActivityHeader(state);
    if (liveActivityHeader) {
      mountIntoLiveElement(state, liveActivityHeader, "activity-header");
      return;
    }

    const respondingStatusContainer = getRespondingStatusContainer(state);
    if (respondingStatusContainer) {
      mountIntoLiveElement(
        state,
        respondingStatusContainer,
        "responding-status"
      );
      return;
    }

    const assistantBlock = getAssistantBlock(state);
    if (assistantBlock) {
      clearLiveMount(state);

      const heading = assistantBlock.querySelector(
        'h4[data-conversation-role="assistant"]'
      );

      if (heading && state.timeline.parentElement !== assistantBlock) {
        assistantBlock.insertBefore(state.timeline, heading);
      }

      window.__compactChappyTiming.timelineMounted = true;
      setMountState("assistant-block", assistantBlock);
      return;
    }

    setMountState(
      getLiveTurn(state) ? "waiting-live-target" : "waiting-live-turn"
    );
  }

  function getActiveSegment(state) {
    if (state.reasoningStartAt == null) return 0;
    if (state.reasoningEndAt == null) return 1;
    if (state.lastTokenAt == null) return 2;
    return -1;
  }

  function renderTimeline(state) {
    if (!isEnhancedThinkingEnabled()) return;

    mountTimeline(state);

    const now = performance.now();
    const activeSegment = getActiveSegment(state);
    const points = [
      state.feReqAt,
      state.reasoningStartAt,
      state.reasoningEndAt,
      state.lastTokenAt
    ];

    state.timeline.querySelectorAll(".cui-timeline-segment").forEach((segment, index) => {
      const start = points[index];
      const end = points[index + 1];
      const duration = segment.querySelector(".cui-timeline-duration");

      if (typeof start !== "number") {
        duration.textContent = "0.0 s";
      } else if (typeof end === "number") {
        duration.textContent = formatDuration(end - start);
      } else if (index === activeSegment) {
        duration.textContent = formatDuration(now - start);
      }

      segment.dataset.active = String(index === activeSegment);
      segment.dataset.complete = String(typeof end === "number");
    });

    const nodeKeys = [
      "feReqAt",
      "reasoningStartAt",
      "reasoningEndAt",
      "lastTokenAt"
    ];

    state.timeline.querySelectorAll(".cui-timeline-node").forEach((node, index) => {
      const reached = typeof state[nodeKeys[index]] === "number";
      const current =
        reached &&
        (index === points.length - 1
          ? activeSegment === -1
          : typeof points[index + 1] !== "number");

      node.dataset.reached = String(reached);
      node.dataset.current = String(current);
    });

    if (state.completionAnimationDone) {
      state.timeline.querySelector(".cui-timeline-total span").textContent =
        formatCompactDuration(state.lastTokenAt - state.feReqAt);
    }
  }

  function startTimer(state) {
    state.timer = window.setInterval(() => renderTimeline(state), 100);
  }

  function stopTimer(state) {
    if (state.timer === null) return;
    window.clearInterval(state.timer);
    state.timer = null;
  }

  function setLastToken(state, perfAt) {
    if (state.lastTokenAt != null) return;
    state.lastTokenAt = perfAt;
    stopTimer(state);
    renderTimeline(state);
    startCompletionAnimation(state);
    recordDomTrace("last-token", {
      turnKey: state.turnKey,
      lastTokenAt: state.lastTokenAt
    });
    window.__compactChappyTiming.traceActive = false;
  }

  function inspectPayload(payload, state) {
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "input_message") {
      const inputMessage = payload.input_message;
      const metadata = inputMessage?.metadata;

      if (typeof inputMessage?.create_time === "number") {
        state.promptBaseAt = epochSecondsToPerformanceTime(inputMessage.create_time);
      }

      if (typeof metadata?.turn_exchange_id === "string") {
        state.turnExchangeId = metadata.turn_exchange_id;
        statesByExchangeId.set(state.turnExchangeId, state);
      }

      recordDomTrace("input-message", {
        turnKey: state.turnKey,
        turnExchangeId: state.turnExchangeId
      });
      return;
    }

    if (payload.type === "message_marker") {
      if (
        payload.marker === "cot_token" &&
        payload.event === "first" &&
        state.cotStartAt == null
      ) {
        state.cotStartAt = performance.now();
        renderTimeline(state);
        recordDomTrace("cot-first-token", {
          turnKey: state.turnKey,
          cotStartAt: state.cotStartAt
        });
      }

      if (payload.marker === "final_channel_token" && payload.event === "first") {
        if (state.cotEndAt == null) {
          state.cotEndAt = performance.now();
          renderTimeline(state);
        }

        state.finalChannelStarted = true;
        recordDomTrace("final-first-token", {
          turnKey: state.turnKey,
          cotEndAt: state.cotEndAt
        });
      }
      return;
    }

    const message = payload.v?.message;
    const metadata = message?.metadata;

    if (
      state.reasoningStartAt == null &&
      typeof metadata?.reasoning_start_time === "number"
    ) {
      state.reasoningStartAt =
        epochSecondsToPerformanceTime(metadata.reasoning_start_time);
      window.__compactChappyTiming.reasoningStartSeen = true;
      renderTimeline(state);
      recordDomTrace("reasoning-start-metadata", {
        turnKey: state.turnKey,
        reasoningStartAt: state.reasoningStartAt
      });
    }

    if (
      state.reasoningEndAt == null &&
      typeof metadata?.reasoning_end_time === "number"
    ) {
      state.reasoningEndAt =
        epochSecondsToPerformanceTime(metadata.reasoning_end_time);
      window.__compactChappyTiming.reasoningEndSeen = true;
      renderTimeline(state);
      recordDomTrace("reasoning-end-metadata", {
        turnKey: state.turnKey,
        reasoningEndAt: state.reasoningEndAt
      });
    }

    if (message?.channel === "final") {
      state.finalChannelStarted = true;
    }

    if (!state.finalChannelStarted) return;

    if (
      payload.p === "/message/content/parts/0" &&
      payload.o === "append" &&
      typeof payload.v === "string"
    ) {
      state.lastContentAt = performance.now();
      return;
    }

    if (Object.keys(payload).length === 1 && typeof payload.v === "string") {
      state.lastContentAt = performance.now();
      return;
    }

    if (payload.p === "" && payload.o === "patch" && Array.isArray(payload.v)) {
      let finished = false;

      for (const operation of payload.v) {
        if (
          operation?.p === "/message/content/parts/0" &&
          operation?.o === "append" &&
          typeof operation?.v === "string"
        ) {
          state.lastContentAt = performance.now();
        }

        if (
          operation?.p === "/message/status" &&
          operation?.o === "replace" &&
          operation?.v === "finished_successfully"
        ) {
          finished = true;
        }
      }

      if (finished && typeof state.lastContentAt === "number") {
        setLastToken(state, state.lastContentAt);
      }
    }
  }

  function inspectDataLine(raw, state) {
    const data = raw.trim();
    if (!data || data === "[DONE]") return;

    window.__compactChappyTiming.sseLines += 1;
    inspectPayload(JSON.parse(data), state);
  }

  function createObservedResponse(response, state) {
    const decoder = new TextDecoder();
    let buffer = "";

    function consumeText(text) {
      buffer += text;

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith("data:")) {
          inspectDataLine(line.slice(5), state);
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    const observedStream = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          consumeText(decoder.decode(chunk, { stream: true }));
          controller.enqueue(chunk);
        },
        flush() {
          consumeText(decoder.decode());

          const finalLine = buffer.replace(/\r$/, "");
          if (finalLine.startsWith("data:")) {
            inspectDataLine(finalLine.slice(5), state);
          }
        }
      })
    );

    const observedResponse = new Response(observedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });

    return new Proxy(observedResponse, {
      get(target, property) {
        if (property === "url") return response.url;
        if (property === "redirected") return response.redirected;
        if (property === "type") return response.type;

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  }

  async function inspectTelemetryRequest(input, init) {
    let text = null;

    if (typeof init?.body === "string") {
      text = init.body;
    } else if (input instanceof Request) {
      text = await input.clone().text();
    }

    if (!text) return;

    const payload = JSON.parse(text);
    const analytics = payload.turn_analytics;

    if (
      !analytics ||
      typeof analytics.turn_exchange_id !== "string" ||
      typeof analytics.api_start_delay !== "number" ||
      typeof analytics.api_open_delay !== "number" ||
      typeof analytics.time_to_last_token_ms !== "number"
    ) {
      return;
    }

    const state = statesByExchangeId.get(analytics.turn_exchange_id);
    if (!state) return;

    const telemetryBaseAt = state.feReqAt - analytics.api_start_delay;

    state.feReqAt = telemetryBaseAt + analytics.api_start_delay;
    state.beRespAt = telemetryBaseAt + analytics.api_open_delay;
    state.lastTokenAt = telemetryBaseAt + analytics.time_to_last_token_ms;

    stopTimer(state);
    renderTimeline(state);
    startCompletionAnimation(state);
    recordDomTrace("telemetry-final", {
      turnKey: state.turnKey,
      apiStartDelay: analytics.api_start_delay,
      apiOpenDelay: analytics.api_open_delay,
      timeToLastTokenMs: analytics.time_to_last_token_ms
    });
  }

  function scheduleMount() {
    if (!isEnhancedThinkingEnabled() || mountQueued || !activeState) return;
    mountQueued = true;

    requestAnimationFrame(() => {
      mountQueued = false;
      if (activeState) mountTimeline(activeState);
    });
  }

  let lastCharacterTraceAt = 0;

  new MutationObserver((records) => {
    if (!isEnhancedThinkingEnabled()) return;

    scheduleMount();

    if (!window.__compactChappyTiming.traceActive) return;

    for (const record of records) {
      for (const node of record.addedNodes) {
        recordMutationNode(node, "added");
      }

      if (
        record.type === "characterData" &&
        performance.now() - lastCharacterTraceAt >= 250
      ) {
        lastCharacterTraceAt = performance.now();
        recordMutationNode(record.target, "text");
      }
    }
  }).observe(document, {
    childList: true,
    characterData: true,
    subtree: true
  });

  new MutationObserver(() => {
    if (!activeState) return;

    if (!isEnhancedThinkingEnabled()) {
      stopTimer(activeState);
      clearLiveMount(activeState);

      if (
        activeState.completionAnimationStarted &&
        !activeState.completionAnimationDone
      ) {
        cleanupCompletionMotion(activeState);
      }

      for (const host of document.querySelectorAll(
        '[data-cui-timeline-host="true"]'
      )) {
        const nativeText = host.dataset.cuiNativeWorkedText;
        const container = host.parentElement;

        if (nativeText) {
          host.textContent = nativeText;
        }

        delete host.dataset.cuiTimelineHost;
        delete host.dataset.cuiNativeWorkedText;

        if (container) {
          delete container.dataset.cuiTimelineHostContainer;
        }
      }

      if (activeState.timeline.isConnected) {
        activeState.timeline.remove();
      }

      return;
    }

    if (
      activeState.lastTokenAt == null &&
      activeState.timer === null
    ) {
      startTimer(activeState);
    }

    renderTimeline(activeState);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"]
  });

  window.fetch = async function (...args) {
    if (!isEnhancedThinkingEnabled()) {
      return originalFetch.apply(this, args);
    }

    const rawUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
    const url = new URL(rawUrl, location.href);

    if (url.pathname === "/ces/v1/telemetry/intake") {
      window.__compactChappyTiming.telemetryRequests += 1;
      inspectTelemetryRequest(args[0], args[1]);
      return originalFetch.apply(this, args);
    }

    if (url.pathname !== "/backend-api/f/conversation") {
      return originalFetch.apply(this, args);
    }

    const timing = window.__compactChappyTiming;
    if (!timing.traceActive) {
      timing.clearDomTrace();
      timing.traceActive = true;
    }

    timing.conversationRequests += 1;
    timing.lastConversationPath = url.pathname;
    timing.timelineMounted = false;
    timing.lastMountState = null;

    const fetchStartedAt = performance.now();

    recordDomTrace("conversation-fetch-start", {
      requestUrl: url.pathname
    });

    const state = {
      turnKey: ++turnSequence,
      turnKeysAtStart: [...document.querySelectorAll("div[data-turn-key]")]
        .map((element) => element.dataset.turnKey)
        .filter(Boolean),
      turnExchangeId: null,
      promptBaseAt: null,
      feReqAt: fetchStartedAt,
      beRespAt: null,
      reasoningStartAt: null,
      reasoningEndAt: null,
      cotStartAt: null,
      cotEndAt: null,
      lastTokenAt: null,
      lastContentAt: null,
      finalChannelStarted: false,
      liveTurn: null,
      liveMountElement: null,
      timeline: createTimeline(),
      timer: null,
      completionAnimationStarted: false,
      completionAnimationDone: false,
      completionAnimations: [],
      completionFrame: null,
      motionOverlay: null
    };

    activeState = state;
    startTimer(state);

    const response = await originalFetch.apply(this, args);
    state.beRespAt = performance.now();
    renderTimeline(state);
    recordDomTrace("conversation-response-open", {
      turnKey: state.turnKey,
      status: response.status,
      beRespAt: state.beRespAt
    });

    if (!response.body) {
      throw new Error("Conversation response has no body stream");
    }

    return createObservedResponse(response, state);
  };
})();
