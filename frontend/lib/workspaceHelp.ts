import type { WindowHelpStep } from "./windowHelp";

/** Specific window tasks take precedence over broad legacy word matching. */
export function workspaceHelp(title:string):WindowHelpStep[]|null {
  const step=(heading:string,text:string)=>({heading,text});
  if(/^New outline$/i.test(title))return [
    step("Choose a starting shape","Choose Empty floorplan, Rectangle, L-shape or Notched rectangle. For a recessed shape, choose its orientation. OK opens a separate warning; it does not delete anything yet."),
    step("Confirm or keep your building","Only Delete contents & start removes the current floors, their placed contents and service layouts, and resets the roof. Cancel or Escape returns to the chooser without changing the project. Undo can restore the previous building. Use File → Save first if you need a permanent backup."),
  ];
  if(/^Save view$/i.test(title))return [
    step("Save the current image","Choose PNG or JPEG and the available image options, then Save as. The image captures the current 3D inspection view, including the selected floors and roof visibility. Cancel leaves the project unchanged."),
    step("Keep an editable copy too","A saved image is not an editable project backup. Use File → Save to download a .floorplan3d file containing every floor, the roof and referenced local models."),
  ];
  if(/^View properties$/i.test(title))return [
    step("Frame the plan or model","Zoom changes magnification; Fit brings the drawing or model back into view. These controls do not change measured dimensions."),
    step("Choose what is visible","In 2D, show or hide room names, dimensions, wall thickness, annotations and the grid. In 3D, choose the wall display and use All floors or Roof. The 3D floor dropdown also offers Whole building; select a named floor to inspect that level again."),
  ];
  if(/^Preferences$/i.test(title))return [
    step("Appearance","System follows your device's Light/Dark setting. Light or Dark fixes the appearance. Compact uses tighter spacing; Comfortable increases text and spacing. These choices apply immediately and are saved on this device when browser storage is available."),
    step("Units and currency","Display units change how dimensions are shown and entered. Dimensions are still stored and calculated in millimetres. Default currency labels costs that have no specific currency; changing it never converts existing amounts."),
    step("Opening another project","The confirmation preference controls whether the planner asks before opening another project file. Done closes Preferences; it does not undo changes made here. Download a project backup before replacing a project you need to keep."),
  ];
  if(/^Build floorplan$/i.test(title))return [
    step("Draw and edit","Use Add wall to draw wall corners, then Enter to finish. Use Modify to select and move existing geometry. Add room extends from a selected boundary wall. Enter measured dimensions rather than relying on the drawing's apparent size."),
    step("Set the right level","The floor dropdown chooses the level you are editing. The adjacent + opens Floors & building for level heights, copies and ordering. New outline replaces the whole building only after its separate warning is confirmed."),
    step("Guidance and history","Import a drawing as a reference and calibrate it against a known distance. Snap to grid and Keep walls squared guide drawing; they do not verify a survey. Undo/Redo restores edits. File → Save keeps an editable backup."),
  ];
  if(/^(Add to plan|Add elements)$/i.test(title))return [
    step("Choose the type of item","Choose a category, then a variant. Review dimensions and the preview before using Add and clicking the plan. Doors, windows and wall-mounted fittings need a suitable wall. Escape cancels placement."),
    step("Edit a placement","Select a placed item to edit its dimensions, position or appearance. The placed object is independent of its catalogue template. Flooring, paint and skirting options apply finishes to the selected room or surface instead of placing furniture."),
  ];
  if(/^Save project as$|^Project download$/i.test(title))return [
    step("Download the editable project","Choose the file name, then save or download the .floorplan3d file. It includes every floor, the roof and the local models referenced by the project. Browser autosave is separate from this portable backup."),
    step("Open it again","Use File → Open project and choose the saved .floorplan3d or .zip file; no unzipping is needed. On mobile, use Download project or Share / Save to Files when offered. Cancel or Done closes this window without deleting your project."),
  ];
  if(/^Appearance(?: & dimensions)?$|^Selected object controls$/i.test(title))return [
    step("Edit the selected object","Review the object's name and measured dimensions before changing its position, rotation, material or component colours. Finishes are visual choices; they do not establish a product's thermal or fit performance."),
    step("Check how changes are saved","In an Appearance dialog, Done applies the draft and Cancel discards it. Other selected-object fields may update immediately. Use the available Undo control for applied changes. The preview can be rotated; its zoom and Fit controls do not resize the real object."),
  ];
  if(/^Camera(?: properties)?$/i.test(title))return [
    step("Frame a view","Adjust the camera position, direction and lens settings while checking the live preview. These change the view, not room or object dimensions. Fit and the view controls help you recover a useful angle."),
    step("Capture and keep the project","Use the camera's capture/save control for an image of the framed view. Use File → Save separately to retain the editable building and camera data. A preview or rendered image is not evidence that a product fits."),
  ];
  if(/^(Human mock.?up|Person|Reference person)$/i.test(title))return [
    step("Check scale and clearance","Set the reference person's dimensions, posture and position to explore usable space. Move it in the selected room and use its update control where shown."),
    step("Keep measurements authoritative","The visual person is a planning reference, not a clearance certificate. Fit decisions must use measured room geometry, product dimensions and the stated uncertainty/tolerances."),
  ];
  if(/^Coordinates$|^Coordinates table$/i.test(title))return [
    step("Edit measured points","Review each corner's X/Y coordinates in the selected display units. Editing a coordinate can change the outline, room area and quantities. Saved coordinates and calculations remain in millimetres."),
    step("Review the result","Check neighbouring walls after editing. Undo restores an applied edit. Changing display units only changes formatting; it does not rescale the building."),
  ];
  if(/^Activity templates$/i.test(title))return [
    step("Choose a template","Search the activity library or filter by phase and trade. Select a template to open an editable activity draft, then confirm its name, room, dates, quantities and costs before saving."),
    step("Keep assumptions explicit","Templates are starting points, not confirmed durations or prices. Create custom instead opens a blank activity; Back returns to the previous choice without adding an activity."),
  ];
  if(/^(Add|Edit) activity$/i.test(title))return [
    step("Define the work","Enter a clear name, phase, room, start/end dates and the relevant trade. Review progress, status, costs and delivery information where offered. Unknown costs should stay unset rather than being treated as zero."),
    step("Check the programme","Review dependencies and timing before saving. Confirming saves this activity; Cancel leaves its draft unapplied. Changing programme dates does not change the floorplan geometry."),
  ];
  if(/PlannerBuild|Project programme|Activity register|Programme health|Quantit|Cost breakdown|Project dashboard/i.test(title))return [
    step("Plan the work","Use Gantt to add activities, set dates, review dependencies and track progress. Dashboard summarises the programme, measured quantities, entered costs and items needing review. Choose a detail card to inspect its source data."),
    step("Review rather than assume","Room quantities come from the saved plan. Dates, prices and progress are planning inputs, not verified completion or supplier commitments. Missing costs stay unknown. Quote Generator creates separate, editable customer quotations from selected project sources."),
  ];
  if(/^Privacy and local saving$/i.test(title))return [
    step("Keep your project safe","The planner can save projects in this browser. Clearing browser data or using another browser/device can make those local copies unavailable. Use File → Save for a portable backup."),
    step("Choose optional services","Review the controls for optional analytics and online features. Your appearance choices and local project data are separate from optional analytics consent. Signing in is not a replacement for downloading backups."),
  ];
  if(/^Object catalogue$/i.test(title))return [
    step("Find and review an item","Filter or search the catalogue, choose an item and inspect its dimensions and available variants. Review the actual product specification before planning a purchase."),
    step("Place a copy","Use the placement control offered by the catalogue, then click the plan. The placed object belongs to the project; editing it does not change the library template. Escape cancels placement."),
  ];
  if(/^(Catalogue entry details|Material entry details|Supplier catalogue entry|Object catalogue manager)$/i.test(title))return [
    step("Review the library record","Check the item's name, category, dimensions and any supplier or material reference. Catalogue values are reusable defaults, not a measured survey or a verified product rating. Confirm specifications against the actual product."),
    step("Know what you are editing","Library administration changes the template used for future placements, not an existing placed object's measured dimensions. A detail preview alone changes nothing. Use the shown save/confirmation action to apply an editable draft; Cancel leaves it unapplied."),
  ];
  if(/^Layout analysis$/i.test(title))return [
    step("Check the intended room","Select the room and confirm its measured geometry, openings, object dimensions and uncertainty before running a check. A 3D image is visual guidance, not the source of a fit decision."),
    step("Review the result","Read collisions, clearances and values needing verification, not just the overall status. Unknown or unverified inputs are not confirmed passes. Use the available analysis controls again after changing the room or a product."),
  ];
  if(/^Local asset library$/i.test(title))return [
    step("Reuse local models","Import a supported local model using the listed file types. Review its measured dimensions, orientation and classification before placing it. Placement copies belong to the selected floor."),
    step("Back up referenced files","File → Save includes the local models referenced by the project. An unplaced library item is not the same as an object on the plan. Review a delete confirmation carefully so you know whether it removes a placement or a library record."),
  ];
  if(/^Account & plans$/i.test(title))return [
    step("Local planning and your account","Local floorplans and portable project files do not require a subscription. Sign in for the available online account services; review the account tabs for their status."),
    step("Plans and payments","Plans & billing explains the available allowances. Choosing a plan is not itself a completed payment; review any separate checkout before confirming it. Close this window to return to the planner without changing the local drawing."),
  ];
  return null;
}
