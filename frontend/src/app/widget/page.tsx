"use client";

import { useState } from "react";
import CherryBlossomCompanion from "@/components/CherryBlossomCompanion";

export default function WidgetPage() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <main
      data-maati-widget
      className="h-screen w-screen bg-transparent overflow-hidden flex items-end justify-end"
    >
      <CherryBlossomCompanion
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onMissionComplete={() => {}}
      />
    </main>
  );
}
