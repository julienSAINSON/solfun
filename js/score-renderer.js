const SVG_NS = "http://www.w3.org/2000/svg";
const STAFF_VIEWBOX_WIDTH = 420;
const STAFF_VIEWBOX_HEIGHT = 220;
const PREVIEW_NOTE_SPACING = 30;

function createSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function clearSvg(svgElement) {
  while (svgElement.firstChild) {
    svgElement.removeChild(svgElement.firstChild);
  }
}

function drawStaff(svgElement, leftX, rightX, bottomLineY, lineSpacing) {
  for (let lineIndex = 0; lineIndex < 5; lineIndex += 1) {
    const y = bottomLineY - lineIndex * lineSpacing;
    svgElement.appendChild(
      createSvgElement("line", {
        x1: leftX,
        y1: y,
        x2: rightX,
        y2: y,
        stroke: "#334155",
        "stroke-width": 2,
        "stroke-linecap": "round",
      })
    );
  }
}

function drawTrebleClef(svgElement, x, y) {
  svgElement.appendChild(
    createSvgElement("text", {
      x,
      y,
      fill: "#1f2b47",
      "font-size": 70,
      "font-family": "Times New Roman, serif",
    })
  ).textContent = "𝄞";
}

function drawBassClef(svgElement, x, y) {
  svgElement.appendChild(
    createSvgElement("text", {
      x,
      y,
      fill: "#1f2b47",
      "font-size": 64,
      "font-family": "Times New Roman, serif",
    })
  ).textContent = "𝄢";
}

function drawClef(svgElement, clef, x, y) {
  if (clef === "bass") {
    drawBassClef(svgElement, x, y - 16);
    return;
  }

  drawTrebleClef(svgElement, x, y);
}

function drawTimingBar(svgElement, x, topY, bottomY) {
  svgElement.appendChild(
    createSvgElement("line", {
      x1: x,
      y1: topY,
      x2: x,
      y2: bottomY,
      stroke: "#2563eb",
      "stroke-width": 3,
      "stroke-dasharray": "5 4",
      "stroke-linecap": "round",
      opacity: 0.95,
    })
  );
}

function drawLedgerLines(svgElement, centerX, y, lineSpacing, stepFromBottomLine) {
  const minimumStep = 0;
  const maximumStep = 8;

  if (stepFromBottomLine < minimumStep) {
    for (let ledgerStep = -2; ledgerStep >= stepFromBottomLine; ledgerStep -= 2) {
      const ledgerY = y - (ledgerStep - stepFromBottomLine) * (lineSpacing / 2);
      svgElement.appendChild(
        createSvgElement("line", {
          x1: centerX - 24,
          y1: ledgerY,
          x2: centerX + 24,
          y2: ledgerY,
          stroke: "#334155",
          "stroke-width": 2,
          "stroke-linecap": "round",
        })
      );
    }
  }

  if (stepFromBottomLine > maximumStep) {
    for (let ledgerStep = maximumStep + 2; ledgerStep <= stepFromBottomLine; ledgerStep += 2) {
      const ledgerY = y - (ledgerStep - stepFromBottomLine) * (lineSpacing / 2);
      svgElement.appendChild(
        createSvgElement("line", {
          x1: centerX - 24,
          y1: ledgerY,
          x2: centerX + 24,
          y2: ledgerY,
          stroke: "#334155",
          "stroke-width": 2,
          "stroke-linecap": "round",
        })
      );
    }
  }
}

function drawNote(svgElement, centerX, y) {
  svgElement.appendChild(
    createSvgElement("ellipse", {
      cx: centerX,
      cy: y,
      rx: 14,
      ry: 10,
      fill: "#111827",
      transform: `rotate(-20 ${centerX} ${y})`,
    })
  );

  svgElement.appendChild(
    createSvgElement("line", {
      x1: centerX + 12,
      y1: y - 2,
      x2: centerX + 12,
      y2: y - 54,
      stroke: "#111827",
      "stroke-width": 3,
      "stroke-linecap": "round",
    })
  );
}

function getStateColor(state) {
  if (state === "correct") {
    return "#1fba62";
  }

  if (state === "incorrect") {
    return "#d94e41";
  }

  return "#111827";
}

function drawIncorrectLabel(svgElement, centerX, y, noteLabel, lineSpacing) {
  if (!noteLabel) {
    return;
  }

  const staffTopY = 94;
  const staffSafeTopY = staffTopY - 14;
  const labelY = Math.min(y - lineSpacing * 1.5, staffSafeTopY);

  svgElement.appendChild(
    createSvgElement("text", {
      x: centerX,
      y: labelY,
      fill: "#b42318",
      "font-size": 13,
      "font-weight": 800,
      "font-family": '"Fredoka", "Baloo 2", "Nunito", "Segoe UI", sans-serif',
      "text-anchor": "middle",
      "dominant-baseline": "auto",
    })
  ).textContent = noteLabel;
}

function drawSequenceNote(svgElement, centerX, y, state, isCurrent, noteLabel, lineSpacing) {
  const color = getStateColor(state);

  if (isCurrent) {
    svgElement.appendChild(
      createSvgElement("ellipse", {
        cx: centerX,
        cy: y,
        rx: 22,
        ry: 16,
        fill: "none",
        stroke: "#4f46e5",
        "stroke-width": 2,
        "stroke-dasharray": "4 4",
        opacity: 0.8,
      })
    );
  }

  svgElement.appendChild(
    createSvgElement("ellipse", {
      cx: centerX,
      cy: y,
      rx: 12,
      ry: 9,
      fill: color,
      transform: `rotate(-20 ${centerX} ${y})`,
    })
  );

  svgElement.appendChild(
    createSvgElement("line", {
      x1: centerX + 11,
      y1: y - 2,
      x2: centerX + 11,
      y2: y - 46,
      stroke: color,
      "stroke-width": 3,
      "stroke-linecap": "round",
    })
  );

  if (state === "incorrect") {
    drawIncorrectLabel(svgElement, centerX, y, noteLabel, lineSpacing);
  }
}

export function renderStaffNote(svgElement, note) {
  clearSvg(svgElement);

  svgElement.setAttribute("viewBox", `0 0 ${STAFF_VIEWBOX_WIDTH} ${STAFF_VIEWBOX_HEIGHT}`);
  svgElement.style.width = "100%";

  const leftX = 72;
  const rightX = 382;
  const clef = String(note?.clef ?? "treble");
  const bottomLineY = 158;
  const lineSpacing = 16;
  const noteCenterX = 258;
  const noteY = bottomLineY - note.stepFromBottomLine * (lineSpacing / 2);

  drawStaff(svgElement, leftX, rightX, bottomLineY, lineSpacing);
  drawClef(svgElement, clef, 92, 154);
  drawLedgerLines(svgElement, noteCenterX, noteY, lineSpacing, note.stepFromBottomLine);
  drawNote(svgElement, noteCenterX, noteY);
}

export function renderStaffSequence(svgElement, notes, states = [], currentIndex = 0, layoutMode = "fit", renderOptions = {}) {
  clearSvg(svgElement);

  const isExpandMode = layoutMode === "expand";
  const isDynamicMode = layoutMode === "dynamic";
  const leftX = 60;
  const noteStartX = 126;
  const baseNoteEndX = 382;
  const noteCount = Array.isArray(notes) ? notes.length : 0;
  const expandedNoteEndX = noteStartX + Math.max(0, noteCount - 1) * PREVIEW_NOTE_SPACING;
  const dynamicSpacing = Number.isFinite(renderOptions.dynamicSpacing) ? renderOptions.dynamicSpacing : 58;
  const dynamicLeadIn = Number.isFinite(renderOptions.dynamicLeadIn) ? renderOptions.dynamicLeadIn : 92;
  const dynamicMotionOffsetX = Number.isFinite(renderOptions.motionOffsetX) ? renderOptions.motionOffsetX : 0;
  const dynamicTimingBarX = Number.isFinite(renderOptions.timingBarX) ? renderOptions.timingBarX : 242;
  const clef = String(renderOptions.clef ?? notes?.[0]?.clef ?? "treble");

  let noteEndX = baseNoteEndX;
  if (isExpandMode) {
    noteEndX = Math.max(baseNoteEndX, expandedNoteEndX);
  } else if (isDynamicMode) {
    noteEndX = Math.max(baseNoteEndX, dynamicTimingBarX + dynamicLeadIn + Math.max(0, noteCount - 1) * dynamicSpacing);
  }

  const rightX = isExpandMode || isDynamicMode ? Math.max(398, noteEndX + 26) : 398;
  const viewBoxWidth = isExpandMode || isDynamicMode ? rightX + leftX : rightX + 22;
  const bottomLineY = 158;
  const lineSpacing = 16;

  svgElement.setAttribute("viewBox", `0 0 ${viewBoxWidth} ${STAFF_VIEWBOX_HEIGHT}`);
  svgElement.style.width = isExpandMode ? `${viewBoxWidth}px` : "100%";

  drawStaff(svgElement, leftX, rightX, bottomLineY, lineSpacing);
  drawClef(svgElement, clef, 78, 154);
  if (isDynamicMode) {
    drawTimingBar(svgElement, dynamicTimingBarX, bottomLineY - lineSpacing * 5.1, bottomLineY + lineSpacing * 1.2);
  }

  if (!Array.isArray(notes) || notes.length === 0) {
    return;
  }

  const spacing = notes.length > 1 ? (noteEndX - noteStartX) / (notes.length - 1) : 0;

  notes.forEach((note, index) => {
    let centerX = notes.length > 1 ? noteStartX + spacing * index : (noteStartX + noteEndX) / 2;
    if (isDynamicMode) {
      centerX = dynamicTimingBarX + dynamicLeadIn + index * dynamicSpacing - dynamicMotionOffsetX;
    }
    const noteY = bottomLineY - note.stepFromBottomLine * (lineSpacing / 2);
    const state = states[index] ?? "pending";

    drawLedgerLines(svgElement, centerX, noteY, lineSpacing, note.stepFromBottomLine);
    drawSequenceNote(
      svgElement,
      centerX,
      noteY,
      state,
      index === currentIndex && state === "pending",
      note?.label,
      lineSpacing
    );
  });
}
