var historicalData = []
var currentRequest = null
var currentServer = null
var currentSnapshot = null
var viewFilters = {
    "runningFilter": function(snapshotEvent) {
        return $("#runningQueries").is(":checked") && (snapshotEvent.command.toLowerCase() != "sleep" && snapshotEvent.status.toLowerCase().indexOf("lock") == -1)
    },
    "lockedFilter": function(snapshotEvent) {
        return $("#lockedQueries").is(":checked") && (snapshotEvent.status.toLowerCase().indexOf("lock") !== -1)
    },
    "sleepingFilter": function(snapshotEvent) {
        return $("#sleepingQueries").is(":checked") && (snapshotEvent.command.toLowerCase() == "sleep")
    }
}

jQuery.ajaxPrefilter(function(options, originalOptions, xhr) {
    if(options.spinner) {
        var spinner = jQuery(options.spinner)
        var contentRemove = jQuery(options.contentRemove)
        if(spinner && spinner.length > 0) {
            var timeoutId = setTimeout(function() {
                if(contentRemove && contentRemove.length > 0) {
                    contentRemove.empty()
                }
                spinner.show()
            }, 250)

            xhr.always(function() {
                clearTimeout(timeoutId)
                spinner.hide()
            })
        }
    }
})

$(document).ready(function() {
    // Load up our list of servers in the dropdown.
    $.ajax("/_getServerGroups", {
        success: function(data, statusCode, xhr) {
            if(data.success && data.payload.groups) {
                $.each(data.payload.groups, function(i, group) {
                    // Add in the category name and divider if this isn't the default category.
                    if(group.groupName != "") {
                        $("#serverList")
                        .append($("<option></option>").html(group.groupName).val("empty"))
                        .append($("<option></option>").html("--------------").val("empty"))
                    }

                    // Add in the servers now.
                    $.each(group.servers, function(i, server) {
                        $("#serverList").append($("<option></option>").html(server.displayName).val(server.internalName))
                    })

                    // Add in a spacer at the end.
                    $("#serverList").append($("<option></option>").html("").val("empty"))
                })

                // Remove the last empty option to tidy up the dropdown.
                $("#serverList option:last-child").remove()
            }
        }
    })

    $("#serverList").on('change', function(e) {
        e.preventDefault()

        // Short circuit if this isn't an actual server selection.
        var selection = $("#serverList option:selected")
        if(selection.val() == "empty") {
            return
        }

        // Clear out any existing errors.
        $("#errors").empty()

        // If this is the current server, just initiate a refresh instead of a full content panel refresh.
        if(currentServer == selection.val()) {
            refreshServerData()
            return
        }

        // Clear out any existing event content since we're loading a brand new server.
        clearEventContent()

        // Get the latest data for the given server.
        pullLatestData(selection.val(), function(serverName, data) {
            // Set our currently server to this one so reclicks on the dropdown don't start a full content panel refresh.
            currentServer = serverName

            // Add this to the front of the historical data list.
            historicalData.unshift({
                "dateTime": moment().format('MMMM Do YYYY, HH:mm:ss'),
                "events": data
            })

            // Draw our events content.
            populateEvents(selection.html(), currentSnapshot, true)
        })
    })

    $("#viewStateControls input[type=checkbox]").on('change', function(e) {
        // Trigger a redraw.
        redrawEvents()
    })
})

function eventMatchesViewState(snapshotEvent) {
    // Go through every configured view filter.
    for(var filterName in viewFilters) {
        // If the filter matches, it means this event belongs in the events display.
        var match = viewFilters[filterName]
        if(match(snapshotEvent)) {
            return true
        }
    }

    return false
}

function pullLatestData(serverName, successCallback) {
    // If we have an existing loading call, abort it.
    if(currentRequest != null) {
        currentRequest.abort()
    }

    // Invoke our request.
    currentRequest = $.ajax("/_getCurrentSnapshot/" + serverName, {
        success: function(data, statusCode, xhr) {
            if(data.success) {
                // Set our current snapshot.
                currentSnapshot = data.payload.events

                // Add this to the front of the historical data list.
                historicalData.unshift({
                    "dateTime": moment().format('MMMM Do YYYY, HH:mm:ss'),
                    "events": data.payload.events
                })

                // Call the user-supplied callback.
                successCallback(serverName)
            } else if(!data.success && data.errorMessage) {
                var message = "We encountered an error while attempting to query the database.  Here's what the server said: <i>" + data.errorMessage + "</i>"
                showErrorMessage("Error while querying server!", message, [retryButton])
            }

            currentRequest = null
        },
        error: function(xhr, textStatus, errorThrown) {
            if(textStatus == "timeout") {
                var message = "We timed out trying to get the most recent process list from the database.  You can try and reload the process list or choose another database server.";
                showErrorMessage("Timeout!", message, [retryButton])
            }

            currentRequest = null
        },
        timeout: 6000,
        spinner: "#spinner",
        contentRemove: "#eventsTable"
    })
}

function populateEventsHeader(serverName) {
    // Build our table header and real-time/historical button group.
    var header = $('<div></div>')
    var headerTitle = $('<h3></h3>').html(serverName)
    var headerTime = $('<small></small>').attr('id', 'displayTime')
    headerTitle.append(headerTime)
    header.append(headerTitle)

    $('#eventsHeader').empty()
    $('#eventsHeader').append(header)

    updateEventsHeaderTime()
}

function updateEventsHeaderTime() {
    $('#displayTime').html('&nbsp;' + moment().format('MMMM Do YYYY, HH:mm:ss'))
}

function populateEventViewOptions(realTime) {
    // Populate the events view options area.
    var buttonGroup = $('<div></div>').addClass('btn-group btn-group-vertical span1').attr('data-toggle', 'buttons-radio')
    var realTimeButton = $('<button></button>').addClass('btn btn-primary btn-block').html('Real Time').on('click', function(e) {
        e.preventDefault()

        // Don't do anything if we're already toggled to the real-time view.
        if($(this).hasClass('active')) {
            return
        }

        // Reset any historical data.
        historicalData = []

        // Add our button to reload the data.
        var reloadButton = $('<button></button>').addClass('btn btn-primary').html('Reload').on('click', function(e) {
            e.preventDefault()

            // Trigger a simple refresh.
            refreshServerData()
        })

        $('#viewSuboptions').empty()
        $('#viewSuboptions').append(reloadButton)
        $('#viewSuboptions').append($('<div></div>').attr('id', 'historicalLinks'))
    })
    var historicalButton = $('<button></button>').addClass('btn btn-primary btn-block').html('Historical').on('click', function(e) {
        e.preventDefault()
    })

    buttonGroup.append(realTimeButton).append(historicalButton)

    var eventViewOptions = $('<div></div>').addClass('row-fluid')
    eventViewOptions.append(buttonGroup)
    eventViewOptions.append(
        $('<div></div>').addClass('span11 well').attr('id', 'viewSuboptions').html('Do stuff here.')
    )

    $('#eventViewOptions').empty()
    $('#eventViewOptions').append(eventViewOptions)

    // Set our real-time or historical button based on what we're loading.
    if(realTime) {
        realTimeButton.click()
    } else {
        historicalButton.click()
    }
}

function populateEventsTable(events) {
    // Build our table.
    var eventTable = $('<table></table>').addClass('table').attr('id', 'eventTable')
    var eventTableBody = $('<tbody></tbody>')

    var eventTableHeader = $('<thead></thead>')
    eventTableHeader.html(
        '<tr>' +
        '<td style="width: 1%">ID</td>' +
        '<td style="width: 1%">Time</td>' +
        '<td style="width: 5%">Host</td>' +
        '<td style="width: 5%">User</td>' +
        '<td style="width: 5%">Database</td>' +
        '<td style="width: 20%">Status</td>' +
        '<td style="width: 60%">SQL</td>' +
        '<td style="width: 1%">Rows Sent</td>' +
        '<td style="width: 1%">Rows Examined</td>' +
        '<td style="width: 1%">Rows Read</td>' +
        '</tr>'
    )

    // Collect the list of unique databases in this set of events.
    var databases = {}

    for(var i = 0; i < events.length; i++) {
        // Make sure this event belongs in the current view based on state toggles (sleeping, locked, etc)
        if(!eventMatchesViewState(events[i]))
            continue

        // Mark this database as being present if it's not empty.
        if(events[i].database != "") {
            databases[events[i].database] = true
        }

        var eventRow = $('<tr></tr>')
        eventRow.html(
            '<td>' + events[i].id + '</td>' +
            '<td>' + events[i].timeElapsed + '</td>' +
            '<td>' + events[i].host.substr(0, events[i].host.indexOf(':')) + '</td>' +
            '<td>' + events[i].user + '</td>' +
            '<td data-database="' + events[i].database + '">' + events[i].database + '</td>' +
            '<td>' + events[i].status + '</td>' +
            '<td>' + events[i].sql + '</td>' +
            '<td>' + events[i].rowsSent + '</td>' +
            '<td>' + events[i].rowsExamined + '</td>' +
            '<td>' + events[i].rowsRead + '</td>'
        )

        // Assign the background color to the row based on the query status.
        if(events[i].status.toLowerCase().indexOf('lock') !== -1) {
            eventRow.addClass('query-locked')
        } else if (events[i].command == "Sleep") {
            eventRow.addClass('query-sleeping')
        } else {
            eventRow.addClass('query-normal')
        }

        eventTableBody.append(eventRow)
    }

    eventTable.append(eventTableHeader)
    eventTable.append(eventTableBody)

    // Set our list of databases.
    $('#databaseList').empty()
    $('#databaseList').append($('<option></option>').val('*').html('*'))

    for(var databaseName in databases) {
        $('#databaseList').append($('<option></option>').val(databaseName).html(databaseName))
    }

    // Clear the old events table and put in our new one.
    $('#eventTable').empty()
    $('#eventTable').append(eventTable)
}

function redrawEvents() {
    // Simply repopulate the events table with the current snapshot.
    populateEventsTable(currentSnapshot)
}

function populateEvents(serverName, events, realTime) {
    // Build our events header - server name, time, etc.
    populateEventsHeader(serverName)

    // Populate the events view options area.
    populateEventViewOptions(realTime)

    // Populate our events table.
    populateEventsTable(events)

    // If we're in real-time mode, redraw our historical data.
    if(realTime) {
        redrawRecentDataList()
    }
}

function redrawRecentDataList() {
}

function refreshServerData() {
    // Clear out any errors, just to be safe.
    $("#errors").empty()

    // Get the latest data for the given server.
    pullLatestData(currentServer, function(serverName) {
        // Clear out the existing event table.
        $('#eventTable').empty()

        // Update the time of the snapshot.
        updateEventsHeaderTime()

        // Populate only the event table itself.
        populateEventsTable(currentSnapshot)

        // Redraw historical data since we got new stuff.
        redrawRecentDataList()
    })
}

function clearEventContent() {
    $('#eventsHeader').empty()
    $('#eventViewOptions').empty()
    $('#eventTable').empty()
}

function showErrorMessage(title, message, appends) {
    var alertBlock = $("<div></div>")
    alertBlock.addClass("alert alert-block alert-error fade in")
    alertBlock.html(
        '<h4>' + title + '</h4>' +
        '<p>' + message + '</p>'
    )

    // Append our appends if we have any.
    if(appends) {
        var appendBlock = $("<p></p>")
        $.each(appends, function(i, append) {
            appendBlock.append(append)
        })

        alertBlock.append(appendBlock)
    }

    // Clear any previous errors before showing this one.
    $("#errors").empty()
    $("#errors").append(alertBlock)
}
