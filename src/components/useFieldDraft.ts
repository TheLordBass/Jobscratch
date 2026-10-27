"use client";

import { useState } from "react";

/**
 * A text box's copy of a saved value while you edit it, saved when you leave the box. When the saved
 * value changes elsewhere (on another device, or on another page kept open in the background), the box
 * shows the new value unless you're typing in it, so leaving the box never saves an older copy over it.
 */
export function useFieldDraft(value: string, save: (text: string) => void) {
  const [text, setText] = useState(value);
  const [typing, setTyping] = useState(false);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (!typing) setText(value);
  }
  return {
    value: text,
    onChange: (event: { target: { value: string } }) => setText(event.target.value),
    onFocus: () => setTyping(true),
    onBlur: () => {
      setTyping(false);
      if (text !== value) save(text);
    },
  };
}
