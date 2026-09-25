import PlannerClient from "./planner-client";
import styles from "./planner-guide.module.css";

export default function PlannerPage() {
  return (
    <>
      <PlannerClient />
      <section className={styles.guide} id="planner-guide" aria-labelledby="planner-guide-title">
        <div className={styles.container}>
          <span className={styles.eyebrow}>PLANNER FIELD NOTES</span>
          <h1 id="planner-guide-title">Create a free floorplan in 2D and 3D</h1>
          <p className={styles.lead}>
            This browser-based planner lets you draw room layouts, inspect a 3D view, and
            download PDF, PNG or JPG images without creating an account. A useful plan
            starts with recorded dimensions and a clear purpose, especially when you
            intend to discuss the layout with a client, colleague or designer.
          </p>
          <div className={styles.steps}>
            <article>
              <span>01 / PREPARE</span>
              <h2>Measure before drawing</h2>
              <p>
                Record wall lengths, doors, windows and fixed features in millimetres.
                Mark estimates and inaccessible edges. If separate wall segments do not
                add up to the overall measurement, check the notes before adjusting the
                digital outline.
              </p>
            </article>
            <article>
              <span>02 / REVIEW</span>
              <h2>Use each view for its purpose</h2>
              <p>
                Draw and check positions in 2D. Trace routes through the rooms and leave
                space for door swings and furniture in use. Switch to 3D to explain the
                arrangement, then return to measurements for decisions about fit.
              </p>
            </article>
            <article>
              <span>03 / KEEP</span>
              <h2>Save the editable project</h2>
              <p>
                Export a readable view for discussion and download a .floorplan3d project
                backup for future edits. Browser storage is local to this device and is
                not a cloud backup. Include the date, revision and open questions when
                sharing an option.
              </p>
            </article>
          </div>
          <p className={styles.note}>
            A concept floorplan supports early decisions; it is not a measured survey,
            architectural construction drawing or approval. Verify critical site
            dimensions and obtain project-specific professional advice before building
            or ordering fitted items.
          </p>
          <nav className={styles.links} aria-label="Floorplan planning guides">
            <a href="/guides/how-to-measure-a-room/">Room measurement guide</a>
            <a href="/guides/plan-your-first-floorplan/">Layout review checklist</a>
            <a href="/guides/save-and-download-floorplans/">Saving and sharing guide</a>
          </nav>
        </div>
      </section>
    </>
  );
}
