"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";

export function CategoryField({
  value,
  categories,
  onChange,
  onBlur,
  inputRef,
}: {
  value: string;
  categories: string[];
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef: (node: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  const unique = new Map<string, string>();
  for (const category of categories) {
    const name = category.trim();
    if (name && !unique.has(name.toLocaleLowerCase()))
      unique.set(name.toLocaleLowerCase(), name);
  }
  const choices = [...unique.values()]
    .filter(
      (c) =>
        !searching ||
        c.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.localeCompare(b));
  const newName = value.trim();
  const canAdd = newName && !unique.has(newName.toLocaleLowerCase());
  const options = [
    ...choices.map((name) => ({ name, add: false })),
    ...(canAdd && searching ? [{ name: newName, add: true }] : []),
  ];
  function choose(name: string) {
    onChange(name);
    setOpen(false);
    setSearching(false);
    setActive(-1);
  }
  return (
    <div
      className="field category-field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          onBlur();
        }
      }}
    >
      <label htmlFor={id}>Category</label>
      <div className="category-control">
        <input
          id={id}
          name="category"
          ref={(node) => {
            input.current = node;
            inputRef(node);
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          placeholder="Pilih atau cari kategori…"
          value={value}
          onFocus={() => {
            setSearching(false);
            setOpen(true);
            setActive(-1);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setSearching(true);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                options.length
                  ? i < 0
                    ? e.key === "ArrowDown"
                      ? 0
                      : options.length - 1
                    : (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                      options.length
                  : -1,
              );
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              const option =
                options[active >= 0 ? active : options.findIndex((o) => o.add)];
              if (option) choose(option.name);
              else setOpen(false);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="category-toggle"
          aria-label="Show categories"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            input.current?.focus();
            setSearching(false);
            setOpen(!open);
          }}
        >
          <ChevronDown size={16} />
        </button>
        {open && (
          <div
            className="category-options"
            id={id + "-list"}
            role="listbox"
            aria-label="Categories"
          >
            {options.length ? (
              options.map((option, index) => (
                <div
                  key={(option.add ? "add:" : "existing:") + option.name}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={active === index}
                  className={
                    "category-option" + (active === index ? " active" : "")
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option.name)}
                >
                  {option.add ? (
                    <Plus size={16} />
                  ) : (
                    <Check
                      size={16}
                      style={{
                        visibility:
                          value === option.name ? "visible" : "hidden",
                      }}
                    />
                  )}
                  <span>
                    {option.add
                      ? `Tambah kategori “${option.name}”`
                      : option.name}
                  </span>
                </div>
              ))
            ) : (
              <p className="category-empty">
                Belum ada kategori. Ketik untuk menambahkan.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
