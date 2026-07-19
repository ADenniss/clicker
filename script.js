const SAVE_KEY = "lumen-clicker-save-v1";

const upgradeDefinitions = [
  {
    id: "focus",
    name: "Prism Focus",
    description: "+1 shard per tap",
    baseCost: 15,
    growth: 1.2,
    accent: "#66ffd0",
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>',
  },
  {
    id: "drone",
    name: "Pulse Drone",
    description: "+2 shards every second",
    baseCost: 80,
    growth: 1.22,
    accent: "#54cfff",
    icon: '<svg viewBox="0 0 24 24"><path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9L12 3Z"></path><path d="m8.5 10 3.5-2 3.5 2v4L12 16l-3.5-2v-4Z"></path></svg>',
  },
  {
    id: "array",
    name: "Solar Array",
    description: "+8 shards every second",
    baseCost: 360,
    growth: 1.25,
    accent: "#8a82ff",
    icon: '<svg viewBox="0 0 24 24"><path d="M5 5h14v11H5zM8 5v11M12 5v11M16 5v11M5 9h14M5 13h14M12 16v5M8 21h8"></path></svg>',
  },
  {
    id: "reactor",
    name: "Void Reactor",
    description: "+35 shards every second",
    baseCost: 1800,
    growth: 1.28,
    accent: "#ff9d66",
    icon: '<svg viewBox="0 0 24 24"><path d="M9 3h6l4.5 4.5v9L15 21H9l-4.5-4.5v-9L9 3Z"></path><circle cx="12" cy="12" r="4"></circle><path d="m12 8 2 4-2 4-2-4 2-4Z"></path></svg>',
  },
];

const defaultState = () => ({
  currency: 0,
  totalEarned: 0,
  totalClicks: 0,
  upgrades: Object.fromEntries(upgradeDefinitions.map((upgrade) => [upgrade.id, 0])),
  muted: false,
  lastSavedAt: Date.now(),
});

let state = loadState();
let selectedBulk = 1;
let combo = 0;
let lastTapAt = 0;
let lastFrameAt = performance.now();
let lastRenderedCurrency = -1;
let audioContext = null;
let toastTimer = null;

const elements = {
  sideBalance: document.querySelector("#sideBalance"),
  shopBalance: document.querySelector("#shopBalance"),
  perClickValue: document.querySelector("#perClickValue"),
  perSecondValue: document.querySelector("#perSecondValue"),
  tapYield: document.querySelector("#tapYield"),
  totalClicks: document.querySelector("#totalClicks"),
  allTimeEnergy: document.querySelector("#allTimeEnergy"),
  upgradeCount: document.querySelector("#upgradeCount"),
  upgradeList: document.querySelector("#upgradeList"),
  coreButton: document.querySelector("#coreButton"),
  clickEffects: document.querySelector("#clickEffects"),
  comboBar: document.querySelector("#comboBar"),
  comboText: document.querySelector("#comboText"),
  unlockProgress: document.querySelector("#unlockProgress"),
  soundButton: document.querySelector("#soundButton"),
  resetButton: document.querySelector("#resetButton"),
  resetDialog: document.querySelector("#resetDialog"),
  cancelReset: document.querySelector("#cancelReset"),
  confirmReset: document.querySelector("#confirmReset"),
  saveStatus: document.querySelector("#saveStatus"),
  toast: document.querySelector("#toast"),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!saved || typeof saved !== "object") return defaultState();

    const clean = defaultState();
    clean.currency = Math.max(0, Number(saved.currency) || 0);
    clean.totalEarned = Math.max(clean.currency, Number(saved.totalEarned) || 0);
    clean.totalClicks = Math.max(0, Math.floor(Number(saved.totalClicks) || 0));
    clean.muted = Boolean(saved.muted);
    clean.lastSavedAt = Number(saved.lastSavedAt) || Date.now();

    for (const upgrade of upgradeDefinitions) {
      clean.upgrades[upgrade.id] = Math.max(0, Math.floor(Number(saved.upgrades?.[upgrade.id]) || 0));
    }

    const awaySeconds = Math.min(4 * 60 * 60, Math.max(0, (Date.now() - clean.lastSavedAt) / 1000));
    const offlineGain = getPerSecond(clean) * awaySeconds;
    if (offlineGain >= 1) {
      clean.currency += offlineGain;
      clean.totalEarned += offlineGain;
      requestAnimationFrame(() => showToast(`WELCOME BACK · +${formatNumber(offlineGain)} OFFLINE SHARDS`));
    }

    return clean;
  } catch {
    return defaultState();
  }
}

function getBasePerClick(targetState = state) {
  return 1 + targetState.upgrades.focus;
}

function getComboMultiplier() {
  if (combo >= 80) return 2;
  if (combo >= 50) return 1.5;
  if (combo >= 20) return 1.25;
  return 1;
}

function getPerClick() {
  return getBasePerClick() * getComboMultiplier();
}

function getPerSecond(targetState = state) {
  return (
    targetState.upgrades.drone * 2 +
    targetState.upgrades.array * 8 +
    targetState.upgrades.reactor * 35
  );
}

function getCost(upgrade, level) {
  return Math.ceil(upgrade.baseCost * upgrade.growth ** level);
}

function getPurchase(upgrade, requestedBulk = selectedBulk) {
  let quantity = 0;
  let totalCost = 0;
  let nextLevel = state.upgrades[upgrade.id];
  const maxQuantity = requestedBulk === "max" ? 10000 : Number(requestedBulk);

  while (quantity < maxQuantity) {
    const cost = getCost(upgrade, nextLevel);
    if (totalCost + cost > state.currency + 1e-8) break;
    totalCost += cost;
    nextLevel += 1;
    quantity += 1;
  }

  if (requestedBulk !== "max" && quantity < maxQuantity) {
    totalCost = 0;
    for (let offset = 0; offset < maxQuantity; offset += 1) {
      totalCost += getCost(upgrade, state.upgrades[upgrade.id] + offset);
    }
    return { quantity: maxQuantity, totalCost, affordable: false };
  }

  return { quantity, totalCost, affordable: quantity > 0 };
}

function buyUpgrade(id) {
  const upgrade = upgradeDefinitions.find((item) => item.id === id);
  if (!upgrade) return;

  const purchase = getPurchase(upgrade);
  if (!purchase.affordable) {
    showToast("INSUFFICIENT LUMEN SHARDS");
    playTone(130, 0.055, "square", 0.02);
    return;
  }

  state.currency -= purchase.totalCost;
  state.upgrades[id] += purchase.quantity;
  playTone(440, 0.08, "sine", 0.03);
  setTimeout(() => playTone(660, 0.1, "sine", 0.025), 45);
  showToast(`${upgrade.name.toUpperCase()} · LEVEL ${state.upgrades[id]}`);
  render(true);
  saveGame();
}

function tapCore(event) {
  const now = performance.now();
  const elapsed = now - lastTapAt;

  if (elapsed < 550) combo = Math.min(100, combo + (elapsed < 180 ? 9 : 6));
  else combo = Math.min(100, combo + 4);

  lastTapAt = now;
  const gain = getPerClick();
  state.currency += gain;
  state.totalEarned += gain;
  state.totalClicks += 1;

  const rect = elements.coreButton.getBoundingClientRect();
  const clientX = event?.clientX || rect.left + rect.width / 2;
  const clientY = event?.clientY || rect.top + rect.height / 2;
  createClickEffect(clientX, clientY, gain);

  elements.coreButton.classList.remove("pressed");
  void elements.coreButton.offsetWidth;
  elements.coreButton.classList.add("pressed");
  playTone(180 + Math.min(combo, 100) * 1.5, 0.045, "sine", 0.018);
  render();
}

function createClickEffect(clientX, clientY, gain) {
  const wrapRect = elements.clickEffects.getBoundingClientRect();
  const x = clientX - wrapRect.left;
  const y = clientY - wrapRect.top;
  const float = document.createElement("span");
  float.className = "gain-float";
  float.textContent = `+${formatNumber(gain)}`;
  float.style.left = `${x}px`;
  float.style.top = `${y}px`;
  elements.clickEffects.append(float);
  float.addEventListener("animationend", () => float.remove(), { once: true });

  for (let i = 0; i < 7; i += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * i) / 7 + Math.random() * 0.35;
    const distance = 28 + Math.random() * 34;
    spark.className = "spark";
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance - 2}px`);
    spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance - 2}px`);
    elements.clickEffects.append(spark);
    spark.addEventListener("animationend", () => spark.remove(), { once: true });
  }
}

function playTone(frequency, duration, type = "sine", volume = 0.02) {
  if (state.muted) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Audio is decorative; gameplay should continue if the browser blocks it.
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (value < 1000) {
    if (value >= 100 || Number.isInteger(value)) return Math.floor(value).toLocaleString("en-US");
    return value.toFixed(1);
  }

  const suffixes = ["K", "M", "B", "T", "Qa", "Qi"];
  let tier = Math.floor(Math.log10(value) / 3) - 1;
  tier = Math.min(tier, suffixes.length - 1);
  const scaled = value / 1000 ** (tier + 1);
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$|(?<=\.[0-9])0$/, "")}${suffixes[tier]}`;
}

function renderUpgrades() {
  elements.upgradeList.innerHTML = upgradeDefinitions
    .map((upgrade) => {
      const level = state.upgrades[upgrade.id];
      const purchase = getPurchase(upgrade);
      const amountLabel = selectedBulk === "max" ? `MAX ${purchase.quantity}` : `BUY ×${purchase.quantity}`;

      return `
        <button
          class="upgrade-card ${purchase.affordable ? "affordable" : ""}"
          type="button"
          data-upgrade="${upgrade.id}"
          ${purchase.affordable ? "" : "disabled"}
          aria-label="Buy ${purchase.quantity} ${upgrade.name} for ${formatNumber(purchase.totalCost)} shards"
        >
          <span class="upgrade-icon" style="--accent: ${upgrade.accent}">${upgrade.icon}</span>
          <span class="upgrade-copy">
            <span class="upgrade-title-line">
              <strong>${upgrade.name}</strong>
              <span class="level-badge">LV ${level}</span>
            </span>
            <p>${upgrade.description}</p>
          </span>
          <span class="upgrade-cost">
            <span>${amountLabel}</span>
            <strong><i class="cost-gem"></i>${formatNumber(purchase.totalCost)}</strong>
          </span>
        </button>`;
    })
    .join("");
}

function render(force = false) {
  const roundedCurrency = Math.floor(state.currency * 10) / 10;
  if (force || roundedCurrency !== lastRenderedCurrency) {
    const currencyText = formatNumber(state.currency);
    elements.sideBalance.textContent = currencyText;
    elements.shopBalance.textContent = currencyText;
    elements.allTimeEnergy.textContent = formatNumber(state.totalEarned);
    elements.unlockProgress.textContent = `${formatNumber(Math.min(state.totalEarned, 25000))} / 25K`;
    renderUpgrades();
    lastRenderedCurrency = roundedCurrency;
  }

  const basePerClick = getBasePerClick();
  const currentPerClick = getPerClick();
  elements.perClickValue.textContent = `+${formatNumber(basePerClick)}`;
  elements.perSecondValue.textContent = `+${formatNumber(getPerSecond())}`;
  elements.tapYield.textContent = `+${formatNumber(currentPerClick)}`;
  elements.totalClicks.textContent = formatNumber(state.totalClicks);
  elements.upgradeCount.textContent = Object.values(state.upgrades).reduce((sum, level) => sum + level, 0);
  elements.soundButton.classList.toggle("muted", state.muted);
  elements.soundButton.setAttribute("aria-pressed", String(state.muted));
  elements.soundButton.title = state.muted ? "Enable sound" : "Mute sound";

  elements.comboBar.style.width = `${combo}%`;
  const multiplier = getComboMultiplier();
  elements.comboText.textContent = multiplier === 1 ? "STABLE" : `×${multiplier.toFixed(multiplier % 1 ? 2 : 0)} YIELD`;
  elements.comboText.style.color = multiplier > 1 ? "var(--mint)" : "";
}

function saveGame() {
  state.lastSavedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  elements.saveStatus.textContent = "PROGRESS SAVED";
  setTimeout(() => {
    elements.saveStatus.textContent = "AUTO-SAVE ACTIVE";
  }, 1400);
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

function gameLoop(now) {
  const delta = Math.min(0.1, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  const passiveGain = getPerSecond() * delta;
  if (passiveGain > 0) {
    state.currency += passiveGain;
    state.totalEarned += passiveGain;
  }

  if (now - lastTapAt > 450 && combo > 0) {
    combo = Math.max(0, combo - delta * 17);
  }

  render();
  requestAnimationFrame(gameLoop);
}

elements.coreButton.addEventListener("pointerdown", tapCore);
elements.coreButton.addEventListener("animationend", () => elements.coreButton.classList.remove("pressed"));

elements.upgradeList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-upgrade]");
  if (card) buyUpgrade(card.dataset.upgrade);
});

document.querySelectorAll(".bulk-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedBulk = button.dataset.bulk === "max" ? "max" : Number(button.dataset.bulk);
    document.querySelectorAll(".bulk-button").forEach((item) => item.classList.toggle("active", item === button));
    render(true);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || elements.resetDialog.open) return;
  const tag = document.activeElement?.tagName;
  if (tag === "BUTTON" && document.activeElement !== elements.coreButton) return;
  event.preventDefault();
  const rect = elements.coreButton.getBoundingClientRect();
  tapCore({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
});

elements.soundButton.addEventListener("click", () => {
  state.muted = !state.muted;
  if (!state.muted) playTone(520, 0.09, "sine", 0.025);
  render();
  saveGame();
});

elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
elements.cancelReset.addEventListener("click", () => elements.resetDialog.close());
elements.resetDialog.addEventListener("click", (event) => {
  if (event.target === elements.resetDialog) elements.resetDialog.close();
});
elements.confirmReset.addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY);
  state = defaultState();
  combo = 0;
  lastRenderedCurrency = -1;
  elements.resetDialog.close();
  render(true);
  saveGame();
  showToast("REACTOR RESET COMPLETE");
});

window.addEventListener("beforeunload", saveGame);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) saveGame();
});
setInterval(saveGame, 10000);

render(true);
requestAnimationFrame(gameLoop);
