import { useNavigate } from "react-router-dom";
import { BODY_FONT, INK, YELLOW } from "./Theme";



export function UIOverlay() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate("/overview")}
      style={{
        position: "fixed",
        top: 20,
        left: 20,
        zIndex: 10,
        appearance: "none",
        fontFamily: BODY_FONT,
        fontSize: 13,
        fontWeight: 700,
        color: INK,
        background: YELLOW,
        border: `1.5px solid ${INK}`,
        borderRadius: 999,
        padding: "10px 20px",
        boxShadow: "0 4px 0 rgba(27, 27, 34, 0.1)",
        cursor: "pointer",
      }}
    >
      ← Overview
    </button>
  );
}
