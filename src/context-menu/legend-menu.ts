// legend-menu.ts

// ----------------------------------
// External Library Imports
// ----------------------------------
import { LegendSeries, LegendGroup} from "../general/global-params"
// ----------------------------------
// Internal Helpers and Types
// ----------------------------------

// ----------------------------------
// UI Components
// ----------------------------------
import { ContextMenu } from "./context-menu"; // Adjust path as necessary

interface LegendMenuOptions {
    contextMenu: ContextMenu;
    handler: any; // Replace with your actual Handler type
}

export class LegendMenu {
    private contextMenu: ContextMenu;
    private handler: any; // Replace with your actual Handler type

    constructor(options: LegendMenuOptions) {
        this.contextMenu = options.contextMenu;
        this.handler = options.handler;
    }

    /**
     * Populates the context menu with options specific to a legend item (series or group).
     * @param legendItem The LegendSeries or LegendGroup item that was right-clicked.
     * @param event The MouseEvent triggering the context menu.
     */
    public populateLegendMenu(legendItem: LegendSeries | LegendGroup, event: MouseEvent): void {
        // Clear existing menu items

        this.contextMenu.clearMenu();

        // Determine if the legendItem is a series or a group
        const isGroup = (item: LegendSeries | LegendGroup): item is LegendGroup => {
            return (item as LegendGroup).seriesList !== undefined;
        };

        if (isGroup(legendItem)) {
            // Populate menu for a LegendGroup
            this.populateGroupMenu(legendItem, event);
        } else {
            // Populate menu for a LegendSeries
            this.populateSeriesMenu(legendItem, event);
        }

        // Optionally, add a "Close Menu" option
        this.contextMenu.separator();
        this.contextMenu.addMenuItem("Close Menu", () => this.contextMenu.hideMenu());

        // Position and display the menu
        this.contextMenu.showMenu(event);
    }

    /**
     * Populates the context menu for a LegendGroup.
     * @param group The LegendGroup to populate the menu for.
     */
    private populateGroupMenu(group: LegendGroup, event: MouseEvent): void {
        // Add Group-Specific Options
        this.contextMenu.addMenuItem("Rename Group", () => {
            const newName = prompt("Enter new group name:", group.name);
            if (newName && newName.trim() !== "") {
                this.renameGroup(group, newName.trim());
            }
        },false);

        this.contextMenu.addMenuItem("Remove All", () => {
            if (confirm(`Are you sure you want to remove the group "${group.name}"? This will also remove all contained series.`)) {
                this.removeGroup(group);
            }
        });

        this.contextMenu.addMenuItem("Ungroup All", () => {
            this.ungroupSeries(group);
        });


        this.contextMenu.showMenu(event)
    }

    /**
     * Populates the context menu for a LegendSeries.
     * @param seriesItem The LegendSeries to populate the menu for.
     */
    private populateSeriesMenu(seriesItem: LegendSeries, event: MouseEvent): void {
        // Add Series-Specific Options
        this.contextMenu.addMenuItem("Open Series Menu", () => {
            // Assuming you have a method to open a detailed series menu
            this.contextMenu.populateSeriesMenu(seriesItem.series,event);
        },false);

        this.contextMenu.addMenuItem("Move to Group ▸", () => {
            this.populateMoveToGroupMenu(seriesItem);
        },false);

        this.contextMenu.addMenuItem("Remove Series", () => {
            if (confirm(`Are you sure you want to remove the series "${seriesItem.name}"?`)) {

                this.handler.legend.removeLegendSeries(seriesItem.series) 
                this.handler.removeSeries(seriesItem.series);

            }
        })
                    
      
        if (seriesItem.primitives){
        this.contextMenu.addMenuItem("Remove Primitives", () => {
            this.removePrimitivesFromSeries(seriesItem);
        });
    }

    if (seriesItem.group
    ){
        this.contextMenu.addMenuItem("Ungroup", () => {
            this.ungroupSeriesFromGroup(seriesItem);
        });
    }
        this.contextMenu.showMenu(event)

    }

    /**
     * Populates the "Move to Group" submenu.
     * @param seriesItem The LegendSeries to move.
     */
    private populateMoveToGroupMenu(seriesItem: LegendSeries): void {
        // Clear existing menu items
        this.contextMenu.clearMenu();

        // List existing groups
        const existingGroups = this.handler.legend._groups;

        existingGroups.forEach((group:LegendGroup) => {
            this.contextMenu.addMenuItem(group.name, () => {
                this.handler.legend.moveSeriesToGroup(seriesItem, group);
            });
        });

        // Option to create a new group
        this.contextMenu.addMenuItem("Create New Group...", () => {
            const newGroupName = prompt("Enter new group name:", "New Group");
            if (newGroupName && newGroupName.trim() !== "") {
                this.createNewGroup(seriesItem, newGroupName.trim());
            }
        });

        if (seriesItem.group
        ){
            this.contextMenu.addMenuItem("Ungroup", () => {
                this.ungroupSeriesFromGroup(seriesItem);
            });
        }

    }

    /**
     * Renames a LegendGroup.
     * @param group The LegendGroup to rename.
     * @param newName The new name for the group.
     */
    private renameGroup(group: LegendGroup, newName: string): void {
        // Update the group's name in the data structure
        group.name = newName;
        group.seriesList.forEach(seriesItem => {
            seriesItem.group = newName}) 
        // Update the DOM element displaying the group name
        const groupHeader = group.row.querySelector('.group-header span');
        if (groupHeader) {
            groupHeader.textContent = newName;
        }

        console.log(`Group renamed to: ${newName}`);
    }

    /**
     * Removes a LegendGroup and all its contained series.
     * @param group The LegendGroup to remove.
     */
    private removeGroup(group: LegendGroup): void {
        this.handler.legend.removeLegendGroup(group)

        // Remove the group from the internal groups array
        this.handler.legend._groups = this.handler.legend._groups.filter((g:LegendGroup) => g !== group);
        console.log(`Group "${group.name}" removed along with its series.`);
    }



    /**
     * Creates a new group and moves the series into it.
     * @param seriesItem The LegendSeries to move.
     * @param newGroupName The name of the new group.
     */
    private createNewGroup(seriesItem: LegendSeries, newGroupName: string): void {
        this.handler.legend.deleteLegendEntry(seriesItem)
        seriesItem.group = newGroupName
        this.handler.legend.addLegendItem(seriesItem)
    }

    /**
     * Removes a LegendSeries from its group, making it standalone.
     * @param seriesItem The LegendSeries to ungroup.
     */
    private ungroupSeriesFromGroup(seriesItem: LegendSeries): void {
        const currentGroupName = this.handler.legend.getGroupOfSeries(seriesItem.series);
        if (currentGroupName) {
            this.handler.legend.deleteLegendEntry(seriesItem)

            seriesItem.group = undefined
        
            this.handler.legend.addLegendItem(seriesItem)
            }

        

        console.log(`Series "${seriesItem.name}" removed from its group and is now standalone.`);
    }

    
    /**
     * Removes all primitives associated with a LegendSeries.
     * @param seriesItem The LegendSeries to remove primitives from.
     */
    private removePrimitivesFromSeries(seriesItem: LegendSeries): void {
        if (seriesItem.series.primitives) {
            Object.values(seriesItem.series.primitives).forEach(primitive => {
                seriesItem.series.detachPrimitive(primitive); // Assuming a remove method exists
                console.log(`Primitive removed from series "${seriesItem.name}".`);
            });
            seriesItem.primitives = undefined; // Reset primitives
        }

        console.log(`All primitives removed from series "${seriesItem.name}".`);
    }

    /**
     * Ungroups all series within a LegendGroup, making them standalone.
     * @param group The LegendGroup to ungroup.
     */
    private ungroupSeries(group: LegendGroup): void {
        group.seriesList.forEach(seriesItem => {
            
            this.handler.legend.deleteLegendEntry(seriesItem)
            seriesItem.group = undefined
            this.handler.legend.addLegendItem(seriesItem)
            // Add to the main legend container as standalone
            
        });

        // Remove the group
        this.removeGroup(group);

        console.log(`All series in group "${group.name}" have been ungrouped and are now standalone.`);
    }
}
