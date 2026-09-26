export function Brand() {
  return (
    <span className="brand">
      <img
        className="brand-symbol brand-symbol-light"
        src="/brand/symbol-light.svg"
        alt=""
        width="36"
        height="36"
      />
      <img
        className="brand-symbol brand-symbol-dark"
        src="/brand/symbol-dark.svg"
        alt=""
        width="36"
        height="36"
      />
      <span>
        Dinheirovisky<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
