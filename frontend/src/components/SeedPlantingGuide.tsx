import { Sprout } from "lucide-react";

const STEPS = [
  {
    number: "01",
    title: "Prepare the seed",
    body: "Use a seed confirmed as native and suitable for your area. If it came from fresh fruit, rinse away all pulp and let it dry in the shade. Don’t wash packeted dry seeds; follow the packet for any soaking or pre-treatment.",
  },
  {
    number: "02",
    title: "Make a seed ball (seed bomb)",
    body: "Mix 5 parts natural clay with 3 parts clean compost. Add only enough water to bind, then make a small nest for the seed and roll it into a marble-sized ball. Air-dry in the shade for about 3 days.",
  },
  {
    number: "03",
    title: "Choose an approved spot",
    body: "Place it on bare, moist soil in your garden, a community planter, or a chai tapri planter only after asking the owner. A street-side patch is suitable only with permission and if it is away from traffic, drains, and water bodies.",
  },
  {
    number: "04",
    title: "Plant with the rains",
    body: "Use a spot that gets the plant’s required light and has room for it to grow. Place the ball on the soil rather than burying it; sow near the start of the rainy season and check that the patch stays moist while it establishes.",
  },
];

export default function SeedPlantingGuide() {
  return (
    <section className="mt-5 border-2 border-[#78916b] bg-[#f2f7e9] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Sprout size={18} />
        <div>
          <p className="font-mono text-[10px] font-black tracking-[.16em] text-[#647551]">MORNING SEED MISSION</p>
          <h3 className="text-lg font-black">From seed to a good planting spot</h3>
        </div>
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {STEPS.map(step => (
          <li key={step.number} className="border border-[#d3ddc8] bg-[#fffdf6] p-3">
            <p className="font-mono text-[10px] font-black text-[#74816d]">STEP {step.number}</p>
            <h4 className="mt-1 font-bold">{step.title}</h4>
            <p className="mt-1 text-xs leading-5 text-[#586453]">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-l-4 border-[#b6823a] bg-[#fff8e6] p-3 text-xs leading-5 text-[#665638]">
        <b>Keep it local and permission-based:</b> don’t scatter unknown, ornamental, or invasive seeds; avoid protected natural areas, farms, roadsides, drains, and waterways. If you can’t verify the species or get permission, plant in a pot or approved community garden instead.
      </p>
    </section>
  );
}
