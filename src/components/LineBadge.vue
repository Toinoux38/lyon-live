<script setup>
/**
 * LineBadge - Displays a single transit line as a colored chip.
 *
 * Props:
 *   line     - Line object from the API ({ id, sName, color, textColor, lName })
 *   active   - Whether this line is currently selected
 *
 * Emits:
 *   toggle   - When the badge is clicked
 */

defineProps({
  line: {
    type: Object,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['toggle'])
</script>

<template>
  <button
    class="line-badge"
    :class="{ 'line-badge--active': active }"
    :style="{
      '--line-bg': `#${line.color}`,
      '--line-text': `#${line.textColor}`,
    }"
    :title="line.lName"
    @click="$emit('toggle', line.id)"
  >
    <span class="line-badge__name">{{ line.sName }}</span>
  </button>
</template>

<style scoped>
.line-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 34px;
  padding: 0 10px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: var(--line-bg);
  color: var(--line-text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
  user-select: none;
  opacity: 0.55;
}

.line-badge:hover {
  transform: scale(1.08);
  opacity: 0.85;
}

.line-badge--active {
  opacity: 1;
  border-color: var(--line-bg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--line-bg) 30%, transparent);
}

.line-badge__name {
  white-space: nowrap;
}
</style>
