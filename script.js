const csvInput = document.querySelector("#csvInput");
const budgetInput = document.querySelector("#budgetInput");
const compareButton = document.querySelector("#compareButton");
const compareContributionButton = document.querySelector("#compareContributionButton");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
const resultsBody = document.querySelector("#resultsBody");
const targetHeader = document.querySelector("#targetHeader");
const sortableHeaders = document.querySelectorAll("th[data-sort]");
let currentRows = [];
let currentRenderOptions = {};
let currentSort = {
  key: "",
  direction: "asc",
};

function parseCsv(text, delimiter = ",") {
  const rows = parseCsvRows(text, delimiter);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const dataRows = rows.slice(1).map((row) => {
    if (row.length === 1 && row[0].includes(delimiter)) {
      return parseCsvRows(row[0], delimiter)[0] || row;
    }

    return row;
  });

  return dataRows.map((row) => {
    return headers.reduce((record, header, index) => {
      record[header] = row[index] ?? "";
      return record;
    }, {});
  });
}

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(value.trim());
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  return rows;
}

function parseAmount(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const amount = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : 0;
}

function formatAmount(value) {
  return new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildCsvCostMap(rows) {
  return rows.reduce((people, row) => {
    const personId = getBookingPersonId(row);

    if (!personId) {
      return people;
    }

    if (!people.has(personId)) {
      people.set(personId, {
        personId,
        csvName: getField(row, "Display"),
        cost: 0,
      });
    }

    const person = people.get(personId);
    person.cost +=
      parseAmount(getField(row, "Fee")) + parseAmount(getField(row, "Price"));

    if (!person.csvName && getField(row, "Display")) {
      person.csvName = getField(row, "Display");
    }

    return people;
  }, new Map());
}

function getBookingPersonId(row) {
  return String(getField(row, "PersonId") || getField(row, "Person ID")).trim();
}

function getBudgetPersonId(row) {
  return String(getField(row, "Person ID") || getField(row, "PersonId")).trim();
}

function getSpouseId(row) {
  return String(getField(row, "Ektefelle ID")).trim();
}

function getField(row, name) {
  const wanted = normalizeHeader(name);
  const key = Object.keys(row).find(
    (header) => normalizeHeader(header) === wanted
  );
  return key ? row[key] : "";
}

function getFieldByPrefix(row, prefix) {
  const wanted = normalizeHeader(prefix);
  const key = Object.keys(row).find((header) =>
    normalizeHeader(header).startsWith(wanted)
  );
  return key ? row[key] : "";
}

function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getGroupKey(personId, spouseId) {
  if (!spouseId) {
    return personId;
  }

  return [personId, spouseId]
    .sort((left, right) => Number(left) - Number(right))
    .join("+");
}

function buildBudgetGroups(rows, targetPrefix) {
  return rows.reduce((groups, row) => {
    const personId = getBudgetPersonId(row);
    const spouseId = getSpouseId(row);

    if (!personId) {
      return groups;
    }

    const groupKey = getGroupKey(personId, spouseId);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        personIds: new Set(),
        names: new Set(),
        budgetGoal: 0,
      });
    }

    const group = groups.get(groupKey);
    group.personIds.add(personId);

    if (spouseId) {
      group.personIds.add(spouseId);
    }

    if (row.Name) {
      group.names.add(row.Name);
    }

    group.budgetGoal = Math.max(
      group.budgetGoal,
      parseAmount(getFieldByPrefix(row, targetPrefix))
    );

    return groups;
  }, new Map());
}

function compareData(csvRows, budgetRows, targetPrefix, options = {}) {
  const differenceDirection = options.differenceDirection || "costMinusTarget";
  const sortMode = options.sortMode || "default";
  const csvPeople = buildCsvCostMap(csvRows);
  const budgetGroups = buildBudgetGroups(budgetRows, targetPrefix);
  const usedCsvPersonIds = new Set();
  const rows = [...budgetGroups.values()].map((group) => {
    const personIds = [...group.personIds].sort(
      (left, right) => Number(left) - Number(right)
    );
    const cost = personIds.reduce((sum, personId) => {
      if (csvPeople.has(personId)) {
        usedCsvPersonIds.add(personId);
      }

      return sum + (csvPeople.get(personId)?.cost ?? 0);
    }, 0);
    const budgetGoal = group.budgetGoal;
    const difference =
      differenceDirection === "targetMinusCost" ? budgetGoal - cost : cost - budgetGoal;
    const missingCsv = !personIds.some((personId) => csvPeople.has(personId));

    return {
      personId: personIds.join(" + "),
      sortPersonId: Number(personIds[0]),
      name: [...group.names].join(" / ") || "(mangler navn)",
      budgetGoal,
      cost,
      difference,
      missingCsv,
      missingBudget: false,
      matches: Math.abs(difference) < 0.005 && !missingCsv,
    };
  });

  csvPeople.forEach((person, personId) => {
    if (!usedCsvPersonIds.has(personId)) {
      rows.push({
        personId,
        sortPersonId: Number(personId),
        name: person.csvName || "(mangler navn)",
        budgetGoal: 0,
        cost: person.cost,
            difference: differenceDirection === "targetMinusCost" ? -person.cost : person.cost,
        missingCsv: false,
        missingBudget: true,
        matches: false,
      });
    }
  });

  return rows.sort((left, right) => {
    if (sortMode === "negativeDifferenceFirst") {
      const leftRank = getDifferenceSortRank(left);
      const rightRank = getDifferenceSortRank(right);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.sortPersonId - right.sortPersonId;
    }

    const leftRank = getSortRank(left);
    const rightRank = getSortRank(right);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.sortPersonId - right.sortPersonId;
  });
}

function getDifferenceSortRank(person) {
  if (person.missingCsv || person.missingBudget) {
    return 1;
  }

  return person.difference < 0 ? 0 : 2;
}

function getSortRank(person) {
  if (!person.matches && !person.missingCsv && !person.missingBudget) {
    return 0;
  }

  if (person.missingCsv || person.missingBudget) {
    return 1;
  }

  return 2;
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type || ""}`.trim();
}

function renderRows(rows, options = {}) {
  const colorMode = options.colorMode || "match";

  if (rows.length === 0) {
    resultsBody.innerHTML =
      '<tr><td colspan="5">Fant ingen personer i inputfeltene.</td></tr>';
    return;
  }

  resultsBody.innerHTML = rows
    .map((row) => {
      const rowClass = getRowClass(row, colorMode);
      const note = row.missingCsv
        ? "Mangler i camp påmeldinger"
        : row.missingBudget
        ? "Mangler i MyShare status"
        : formatAmount(row.difference);

      return `
      <tr class="${rowClass}">
        <td>${escapeHtml(row.personId)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="number">${formatAmount(row.budgetGoal)}</td>
        <td class="number">${formatAmount(row.cost)}</td>
        <td class="number">${escapeHtml(note)}</td>
      </tr>
    `;
    })
    .join("");
}

function getRowClass(row, colorMode) {
  if (row.missingCsv || row.missingBudget) {
    return "warning";
  }

  if (colorMode === "differenceSign") {
    return row.difference < 0 ? "mismatch" : "positive";
  }

  if (row.matches) {
    return "positive";
  }

  return "mismatch";
}

function sortRows(rows, sort) {
  if (!sort.key) {
    return [...rows];
  }

  const direction = sort.direction === "desc" ? -1 : 1;

  return [...rows].sort((left, right) => {
    const comparison = compareSortValues(getSortValue(left, sort.key), getSortValue(right, sort.key));

    if (comparison !== 0) {
      return comparison * direction;
    }

    return (left.sortPersonId - right.sortPersonId) * direction;
  });
}

function getSortValue(row, key) {
  if (key === "personId") {
    return row.sortPersonId;
  }

  return row[key];
}

function compareSortValues(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left || "").localeCompare(String(right || ""), "nb-NO", {
    numeric: true,
    sensitivity: "base",
  });
}

function updateSortIndicators() {
  sortableHeaders.forEach((header) => {
    header.classList.toggle("sort-asc", header.dataset.sort === currentSort.key && currentSort.direction === "asc");
    header.classList.toggle("sort-desc", header.dataset.sort === currentSort.key && currentSort.direction === "desc");
  });
}

function clearSort() {
  currentSort = {
    key: "",
    direction: "asc",
  };
  updateSortIndicators();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function runComparison(targetPrefix, targetLabel, options = {}) {
  try {
    const csvRows = parseCsv(csvInput.value, ",");
    const budgetRows = parseCsv(budgetInput.value, ";");
    const comparison = compareData(csvRows, budgetRows, targetPrefix, options);
    const mismatches = comparison.filter((person) => !person.matches).length;

    currentRows = comparison;
    currentRenderOptions = options;
    clearSort();
    targetHeader.textContent = targetLabel;
    renderRows(currentRows, currentRenderOptions);
    summaryEl.innerHTML = `
      <span><strong>${comparison.length}</strong> rader sammenlignet</span>
      <span><strong>${mismatches}</strong> rader må sjekkes</span>
      <span><strong>${csvRows.length}</strong> rader lest fra camp påmeldinger</span>
      <span><strong>${budgetRows.length}</strong> rader lest fra MyShare status</span>
      <span>Sammenlignet mot <strong>${escapeHtml(targetLabel)}</strong></span>
    `;

    setStatus("Sammenligning fullført.", "success");
  } catch (error) {
    summaryEl.textContent = "Kunne ikke sammenligne dataene.";
    resultsBody.innerHTML =
      '<tr><td colspan="5">Rett inputdataene og prøv igjen.</td></tr>';
    setStatus(error.message, "error");
  }
}

compareButton.addEventListener("click", () => {
  runComparison("Totalt budsjett", "Bidragsplan");
});

compareContributionButton.addEventListener("click", () => {
  runComparison("Totalt bidrag", "Totalt bidrag", {
    colorMode: "differenceSign",
    differenceDirection: "targetMinusCost",
    sortMode: "negativeDifferenceFirst",
  });
});

sortableHeaders.forEach((header) => {
  header.addEventListener("click", () => {
    const key = header.dataset.sort;

    if (!currentRows.length || !key) {
      return;
    }

    currentSort = {
      key,
      direction:
        currentSort.key === key && currentSort.direction === "asc" ? "desc" : "asc",
    };

    updateSortIndicators();
    renderRows(sortRows(currentRows, currentSort), currentRenderOptions);
  });
});
